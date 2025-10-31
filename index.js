const { google } = require('googleapis');
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const readline = require('readline');
const nodemailer = require('nodemailer');
const Levenshtein = require('levenshtein');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const TOKEN_PATH = 'token.json';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];

class SoapNotesExtractor {
  constructor() {
    // Try to use service account first, fallback to OAuth2
    let auth;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        let credentials;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
          // Load from file path
          const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
          const fullPath = keyPath.startsWith('/') ? keyPath : `${__dirname}/${keyPath}`;
          credentials = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        } else {
          // Load from environment variable
          credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        }
        auth = new google.auth.GoogleAuth({
          credentials,
          scopes: SCOPES
        });
        this.authClient = auth;
        console.log('Using Service Account authentication');
      } catch (error) {
        console.log('Service account setup failed, falling back to OAuth2:', error.message);
        auth = this.setupOAuth2();
      }
    } else {
      auth = this.setupOAuth2();
    }
    
    this.sheets = google.sheets({ version: 'v4', auth });
    this.drive = google.drive({ version: 'v3', auth });
    
    // Track results for reporting
    this.results = {
      extracted: [],
      noPdfFound: [],
      noCommentFound: [],
      fuzzyMatches: [], // Track fuzzy matches that might need verification
      errors: []
    };
  }
  
  setupOAuth2() {
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    return this.oAuth2Client;
  }

  async authorize() {
    // If using service account, no authorization needed
    if (this.authClient) {
      return;
    }
    
    // OAuth2 flow - check if we have previously stored a token
    try {
      const token = fs.readFileSync(TOKEN_PATH);
      this.oAuth2Client.setCredentials(JSON.parse(token));
      
      // Set up automatic token refresh
      this.oAuth2Client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
          // Store the refresh token for future use
          const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
          currentTokens.refresh_token = tokens.refresh_token;
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentTokens));
        }
        if (tokens.access_token) {
          // Update access token
          const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
          currentTokens.access_token = tokens.access_token;
          currentTokens.expiry_date = tokens.expiry_date;
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentTokens));
          console.log('✅ Token refreshed automatically');
        }
      });
      
      return;
    } catch (error) {
      console.log('Token file not found or invalid, getting new token...');
      // Get new token
      await this.getNewToken();
    }
  }

  async getNewToken() {
    const authUrl = this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    
    console.log('Authorize this app by visiting this url:', authUrl);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    return new Promise((resolve, reject) => {
      rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        this.oAuth2Client.getToken(code, (err, token) => {
          if (err) {
            console.error('Error retrieving access token', err);
            reject(err);
            return;
          }
          this.oAuth2Client.setCredentials(token);
          // Store the token to disk for later program executions
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
          console.log('Token stored to', TOKEN_PATH);
          resolve();
        });
      });
    });
  }

  async getSheetData() {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${process.env.SHEET_NAME}!A:Q`,
      });
      
      return response.data.values || [];
    } catch (error) {
      console.error('Error reading sheet data:', error);
      throw error;
    }
  }

  // Normalize strings for better matching
  normalize(str) {
    return str.trim().toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Remove common name suffixes for better matching
  removeNameSuffixes(name) {
    const suffixes = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'];
    let cleanName = name.trim();
    
    for (const suffix of suffixes) {
      const pattern = new RegExp(`\\s+${suffix}$`, 'i');
      cleanName = cleanName.replace(pattern, '');
    }
    
    return cleanName.trim();
  }

  // Clean and normalize date format
  cleanDate(sessionDate) {
    const [mm, dd, yyyy] = sessionDate.split('/');
    return `${String(+mm).padStart(2,'0')}/${String(+dd).padStart(2,'0')}/${yyyy}`;
  }

  // Calculate similarity using Levenshtein distance
  calculateSimilarity(str1, str2) {
    const distance = new Levenshtein(this.normalize(str1), this.normalize(str2));
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - (distance.distance / maxLength);
  }

  async searchPDFByClientName(clientName) {
    try {
      // Search in entire Google Drive (including subfolders) for PDFs matching client name
      // Split the client name to search for both parts (case-insensitive)
      const nameParts = clientName.split(' ');
      let queries = [];

      if (nameParts.length >= 2) {
        // Search for files containing both first and last name
        // Try multiple variations to handle case sensitivity issues
        const firstName = nameParts[0].trim();
        const lastName = nameParts[nameParts.length - 1].trim();

        // Build query for files containing both first and last name (any case)
        queries.push(`name contains '${firstName}' and name contains '${lastName}'`);
        queries.push(`name contains '${firstName.toLowerCase()}' and name contains '${lastName.toLowerCase()}'`);
        queries.push(`name contains '${firstName.toUpperCase()}' and name contains '${lastName.toUpperCase()}'`);
      } else {
        // Fallback to search for single names
        queries.push(`name contains '${clientName}'`);
        queries.push(`name contains '${clientName.toLowerCase()}'`);
        queries.push(`name contains '${clientName.toUpperCase()}'`);
      }

      // Try each query variation and collect all results
      let allResults = [];
      for (const nameQuery of queries) {
        const exactQuery = `${nameQuery} and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.document') and trashed=false`;

        const exactResponse = await this.drive.files.list({
          q: exactQuery,
          fields: 'files(id, name)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        if (exactResponse.data.files && exactResponse.data.files.length > 0) {
          allResults = allResults.concat(exactResponse.data.files);
        }
      }

      // Remove duplicates based on file ID
      const uniqueResults = [];
      const seenIds = new Set();
      for (const file of allResults) {
        if (!seenIds.has(file.id)) {
          seenIds.add(file.id);
          uniqueResults.push(file);
        }
      }

      const exactResponse = { data: { files: uniqueResults } };
      
      // If exact search finds results, filter them to ensure they actually match properly
      if (exactResponse.data.files && exactResponse.data.files.length > 0) {
        const filteredFiles = exactResponse.data.files.filter(file => {
          const normalizedFileName = this.normalize(file.name);
          const normalizedClientName = this.normalize(clientName);
          
          // For multi-part names, ensure both first and last name are present
          if (nameParts.length >= 2) {
            const firstName = this.normalize(nameParts[0]);
            const lastName = this.normalize(nameParts[nameParts.length - 1]);
            return normalizedFileName.includes(firstName) && normalizedFileName.includes(lastName);
          } else {
            return normalizedFileName.includes(normalizedClientName);
          }
        });
        
        if (filteredFiles.length > 0) {
          console.log(`Found ${filteredFiles.length} PDF files for "${clientName}" (exact match):`);
          filteredFiles.forEach(file => {
            console.log(`  - ${file.name} (ID: ${file.id})`);
          });
          // Mark as exact matches (not fuzzy)
          return filteredFiles.map(file => ({
            ...file,
            isFuzzyMatch: false
          }));
        }
      }
      
      // Fuzzy matching disabled - only use exact matches
      console.log(`No exact matches for "${clientName}". Fuzzy matching is disabled.`);
      console.log(`Please rename the PDF in Google Drive to match: "${clientName}"`);
      return []; // Return empty array instead of trying fuzzy matching

      /* FUZZY MATCHING CODE DISABLED - Uncomment to re-enable
      // If no exact matches, try STRICT fuzzy matching with minimum similarity threshold
      console.log(`No exact matches for "${clientName}", trying STRICT fuzzy matching...`);

      // Search for all PDFs and filter with strict fuzzy matching
      let allFiles = [];
      let pageToken = null;

      do {
        const allResponse = await this.drive.files.list({
          q: `(mimeType='application/pdf' or mimeType='application/vnd.google-apps.document')`,
          fields: 'nextPageToken, files(id, name)',
          pageSize: 1000,
          pageToken
        });
        
        allFiles = allFiles.concat(allResponse.data.files || []);
        pageToken = allResponse.data.nextPageToken;
      } while (pageToken);
      
      console.log(`Searching through ${allFiles.length} total PDF files...`);
      
      const normalizedClientName = this.normalize(clientName);
      const clientNameNoSuffix = this.removeNameSuffixes(clientName);
      const normalizedClientNameNoSuffix = this.normalize(clientNameNoSuffix);
      const fuzzyMatches = [];
      
      // Minimum similarity threshold for matching (0.90 = 90% similarity required)
      // Increased from 0.85 to reduce false positives
      const MIN_SIMILARITY_THRESHOLD = 0.90;
      
      if (allFiles.length > 0) {
        for (const file of allFiles) {
          const normalizedFileName = this.normalize(file.name);
          const fileNameNoSuffix = this.removeNameSuffixes(file.name);
          const normalizedFileNameNoSuffix = this.normalize(fileNameNoSuffix);
          
          let bestSimilarity = 0;
          let matched = false;
          
          // 1. Compare full names (with and without suffixes)
          const sim1 = this.calculateSimilarity(clientName, file.name);
          const sim2 = this.calculateSimilarity(clientNameNoSuffix, fileNameNoSuffix);
          const sim3 = this.calculateSimilarity(clientName, fileNameNoSuffix);
          const sim4 = this.calculateSimilarity(clientNameNoSuffix, file.name);
          
          bestSimilarity = Math.max(sim1, sim2, sim3, sim4);
          
          // Only consider it a match if similarity is above threshold
          if (bestSimilarity >= MIN_SIMILARITY_THRESHOLD) {
            matched = true;
          }
          
          // Additional check: For multi-word names, ensure ALL name parts are present
          if (matched) {
            const clientParts = clientNameNoSuffix.toLowerCase().split(' ').filter(part => part.length > 1);
            const fileParts = fileNameNoSuffix.toLowerCase().split(/[\s\-_]+/).filter(part => part.length > 1);
            
            // Each client name part must have a corresponding match in filename
            const allPartsMatch = clientParts.every(clientPart => {
              return fileParts.some(filePart => {
                const partSimilarity = this.calculateSimilarity(clientPart, filePart);
                return partSimilarity >= 0.8; // 80% similarity for individual parts
              });
            });
            
            if (!allPartsMatch) {
              matched = false;
              console.log(`❌ Rejected ${file.name} for ${clientName}: not all name parts match`);
            }
          }
          
          if (matched) {
            fuzzyMatches.push({
              ...file,
              similarity: bestSimilarity
            });
            console.log(`✅ Fuzzy match: ${file.name} (similarity: ${(bestSimilarity * 100).toFixed(1)}%)`);
          }
        }
      }
      
      // Sort by similarity score (highest first) and take top matches
      // Prioritize files that contain "massage" (including "medical massage", "massage and float", etc.)
      fuzzyMatches.sort((a, b) => {
        const aHasMassage = a.name.toLowerCase().includes('massage');
        const bHasMassage = b.name.toLowerCase().includes('massage');
        const aFloatOnly = a.name.toLowerCase().includes('float') && !aHasMassage;
        const bFloatOnly = b.name.toLowerCase().includes('float') && !bHasMassage;
        const aFacialOnly = a.name.toLowerCase().includes('facial') && !aHasMassage;
        const bFacialOnly = b.name.toLowerCase().includes('facial') && !bHasMassage;
        
        // Always prioritize files with "massage" over float-only or facial-only files
        if (aHasMassage && !bHasMassage) return -1;
        if (!aHasMassage && bHasMassage) return 1;
        
        // Deprioritize float-only and facial-only files
        if (aFloatOnly && !bFloatOnly) return 1;
        if (!aFloatOnly && bFloatOnly) return -1;
        if (aFacialOnly && !bFacialOnly) return 1;
        if (!aFacialOnly && bFacialOnly) return -1;
        
        // Otherwise sort by similarity score
        return b.similarity - a.similarity;
      });
      const topMatches = fuzzyMatches.slice(0, 5); // Take top 5 matches
      
      console.log(`Found ${topMatches.length} fuzzy matches for "${clientName}":`);
      topMatches.forEach(file => {
        console.log(`  - ${file.name} (ID: ${file.id}, Similarity: ${(file.similarity * 100).toFixed(1)}%)`);
      });
      
      // Mark these results as fuzzy matches for tracking
      return topMatches.map(match => ({
        ...match,
        isFuzzyMatch: true
      }));
      END OF FUZZY MATCHING CODE */

    } catch (error) {
      console.error('Error searching for PDF:', error);
      throw error;
    }
  }

  async getFileComments(fileId) {
    try {
      let comments = [];
      let pageToken = null;
      
      do {
        const res = await this.drive.comments.list({
          fileId,
          pageSize: 100,
          includeDeleted: false,
          fields: 'nextPageToken, comments(id, content, createdTime, replies(id, content, createdTime))',
          pageToken
        });
        comments = comments.concat(res.data.comments || []);
        pageToken = res.data.nextPageToken;
      } while (pageToken);

      // flatten replies
      const all = [];
      for (const c of comments) {
        all.push(c);
        (c.replies || []).forEach(r =>
          all.push({ id: r.id, content: r.content, createdTime: r.createdTime })
        );
      }

      console.log(`Comments for file ${fileId}:`);
      all.forEach(c =>
        console.log(`${c.id} | ${c.createdTime} | ${c.content}`)
      );

      console.log(`  Total comments + replies retrieved: ${all.length}`);
      return all;
      
    } catch (error) {
      console.error('Error getting file comments:', error);
      throw error;
    }
  }

  async downloadPDF(fileId) {
    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      return Buffer.from(response.data);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      throw error;
    }
  }

  async extractCommentsFromPDF(pdfBuffer) {
    try {
      // Try using pdf-lib to extract annotations
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pages = pdfDoc.getPages();
      
      let allAnnotations = [];
      
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const annotations = page.node.lookup('Annots');
        
        if (annotations) {
          // Extract annotation content
          const annotArray = annotations.asArray();
          for (const annot of annotArray) {
            try {
              const annotObj = annot.deref();
              const contents = annotObj.lookup('Contents');
              if (contents) {
                allAnnotations.push(contents.decodeText());
              }
            } catch (e) {
              // Skip annotations that can't be read
            }
          }
        }
      }
      
      // Also get regular text content
      const textData = await pdfParse(pdfBuffer);
      
      return {
        text: textData.text,
        annotations: allAnnotations,
        info: textData.info,
        metadata: textData.metadata
      };
    } catch (error) {
      console.error('Error extracting comments from PDF:', error);
      // Fallback to regular text extraction
      const data = await pdfParse(pdfBuffer);
      return {
        text: data.text,
        annotations: [],
        info: data.info,
        metadata: data.metadata
      };
    }
  }

  findSoapNoteByDate(comments, targetDate) {
    // Parse target date - now clean without time part
    const dateParts = targetDate.split('/');
    
    if (dateParts.length < 3) {
      console.log(`Invalid date format: ${targetDate}`);
      return null;
    }
    
    const [m, d, rawYear] = targetDate.split('/').map(s => parseInt(s, 10));
    // Handle 2-digit years (25 → 2025)
    const y = rawYear < 100 ? 2000 + rawYear : rawYear;
    
    // Build match patterns - more comprehensive
    const patterns = [
      `${m}/${d}/${y}`,            // e.g. "6/6/2025"
      `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${y}`,  // "06/06/2025"
      
      // Two-digit year versions (most common)
      `${m}/${d}/${String(y).slice(-2)}`,  // "6/6/25"
      `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${String(y).slice(-2)}`,  // "06/06/25"
      
      // Month names (full and abbreviated) for patterns like "jun/6/2025", "jul/09/2025"
      `${this.getMonthName(m).toLowerCase()}/${d}/${y}`,
      `${this.getMonthName(m).slice(0, 3).toLowerCase()}/${d}/${y}`,
      `${this.getMonthName(m).slice(0, 3).toUpperCase()}/${d}/${y}`,
      `${this.getMonthName(m).slice(0, 3).toLowerCase()}/${d}/${String(y).slice(-2)}`,
      
      // Month abbreviations with padded day like "jul/09/2025"
      `${this.getMonthName(m).slice(0, 3).toLowerCase()}/${String(d).padStart(2,'0')}/${y}`,
      `${this.getMonthName(m).slice(0, 3).toUpperCase()}/${String(d).padStart(2,'0')}/${y}`,
      `${this.getMonthName(m).slice(0, 3).toLowerCase()}/${String(d).padStart(2,'0')}/${String(y).slice(-2)}`,
      
      // Different separators
      `${m}-${d}-${y}`,
      `${m}.${d}.${y}`,
      `${m}-${d}-${String(y).slice(-2)}`,
      `${m}.${d}.${String(y).slice(-2)}`,
      
      // Space variations common in comments like "CS 6/6/25"
      ` ${m}/${d}/${String(y).slice(-2)}`,
      ` ${m}/${d}/${y}`,
    ];
    
    console.log(`Searching for date patterns: ${patterns.join(', ')}`);
    console.log(`Available comments: ${comments.length}`);
    
    for (const comment of comments) {
      const commentDate = new Date(comment.createdTime);

      console.log(`Comment date: ${commentDate.toLocaleDateString('en-US')}, Content preview: ${comment.content.substring(0, 100)}...`);

      const contentLower = comment.content.toLowerCase();

      // Method 1 (PRIORITY): Search for date patterns in comment content first
      // This is most accurate - the date in the SOAP note text itself
      for (const pattern of patterns) {
        if (contentLower.includes(pattern.toLowerCase())) {
          console.log(`✅ MATCH FOUND: Comment content mentions date pattern: ${pattern}`);
          return comment.content;
        }
      }

      // Method 2: More flexible search - look for any occurrence of the date components
      // This catches cases like "CS 6/6/25" where there might be extra text around it
      const flexiblePatterns = [
        `${m}/${d}/${String(y).slice(-2)}`,
        `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${String(y).slice(-2)}`,
      ];

      for (const pattern of flexiblePatterns) {
        if (contentLower.indexOf(pattern) !== -1) {
          console.log(`✅ MATCH FOUND: Flexible search found date pattern: ${pattern}`);
          return comment.content;
        }
      }
    }

    // Method 3 (FALLBACK): Check if comment creation date matches target date
    // Only use this as last resort since multiple comments may be created same day
    for (const comment of comments) {
      const commentDate = new Date(comment.createdTime);

      if (commentDate.getFullYear() === y &&
          commentDate.getMonth() + 1 === m &&
          commentDate.getDate() === d) {
        console.log(`✅ MATCH FOUND (fallback): Comment creation date matches session date`);
        return comment.content;
      }
    }
    
    console.log(`❌ No matching comment found for date: ${targetDate}`);
    return null;
  }

  getMonthName(monthNum) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[parseInt(monthNum) - 1] || '';
  }

  async updateSheetCell(row, column, value) {
    try {
      const range = `${process.env.SHEET_NAME}!${column}${row}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: [[value]]
        }
      });
      
      console.log(`Updated cell ${range} with SOAP note`);
    } catch (error) {
      console.error('Error updating sheet cell:', error);
      throw error;
    }
  }

  async processRow(rowIndex, rowData) {
    const date = rowData[0]; // Column A
    const claimDate = rowData[1]; // Column B (0-indexed)
    const therapistName = rowData[3]; // Column D (0-indexed)
    const clientName = rowData[5]; // Column F (0-indexed)
    const existingSoapNote = rowData[15]; // Column P (0-indexed)

    // Skip if no date or client name, or if SOAP note already exists
    if (!date || !clientName || existingSoapNote) {
      return;
    }

    // Only process rows from the last 60 days (skip old appointments)
    try {
      const appointmentDate = new Date(date);
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      if (appointmentDate < sixtyDaysAgo) {
        // Skip silently - too old
        return;
      }
    } catch (err) {
      // If date parsing fails, continue anyway (better to process than skip)
    }
    
    // Skip if no actual date in claim column - means client didn't show up
    // Check if claimDate looks like a date (various formats: 6/10, 6/10/25, 6/10/2025, 6-10, etc.)
    const hasDate = claimDate && claimDate.trim() !== '' && 
                   /\d+[\/\-]\d+([\/\-]\d+)?/.test(claimDate.trim());
    if (!hasDate) {
      console.log(`Skipping ${clientName} - ${date}: Column B is "${claimDate || 'empty'}" (no actual date - client didn't show up)`);
      return;
    }
    
    // Clean and normalize the date
    const cleanedDate = this.cleanDate(date);
    console.log(`Processing: ${clientName} - ${date} (cleaned: ${cleanedDate})`);
    
    try {
      // Search for PDF file
      const pdfFiles = await this.searchPDFByClientName(clientName);
      
      if (pdfFiles.length === 0) {
        console.log(`No PDF found for client: ${clientName}`);
        this.results.noPdfFound.push({ clientName, date, therapistName, row: rowIndex + 1 });
        return;
      }
      
      // Check all PDFs for this client until we find one with comments
      let soapNote = null;
      let checkedPdfNames = [];
      
      for (const pdfFile of pdfFiles) {
        console.log(`Checking PDF: ${pdfFile.name}`);
        checkedPdfNames.push(pdfFile.name);
        
        // Get Google Drive comments for this file
        const comments = await this.getFileComments(pdfFile.id);
        console.log(`  Comments found: ${comments.length}`);
        
        if (comments.length > 0) {
          // Find SOAP note for the specific date (use both original and cleaned date)
          soapNote = this.findSoapNoteByDate(comments, date);
          
          if (!soapNote && cleanedDate !== date) {
            // Try with cleaned date if original didn't work
            soapNote = this.findSoapNoteByDate(comments, cleanedDate);
          }
          
          if (soapNote) {
            console.log(`  ✅ Found SOAP note in ${pdfFile.name}`);
            break; // Stop looking once we find a match
          }
        }
      }
      
      if (soapNote) {
        // Update the sheet with the SOAP note
        await this.updateSheetCell(rowIndex + 1, process.env.SOAP_NOTES_COLUMN, soapNote);
        console.log(`SOAP note extracted for ${clientName} on ${date}`);
        
        // Check if any of the PDFs used were fuzzy matches
        const fuzzyMatchUsed = pdfFiles.some(pdf => pdf.isFuzzyMatch);
        if (fuzzyMatchUsed) {
          const fuzzyPdfNames = pdfFiles.filter(pdf => pdf.isFuzzyMatch).map(pdf => pdf.name);
          console.log(`⚠️  FUZZY MATCH used for ${clientName}: ${fuzzyPdfNames.join(', ')}`);
          this.results.fuzzyMatches.push({ 
            clientName, 
            date, 
            therapistName, 
            row: rowIndex + 1, 
            pdfNames: fuzzyPdfNames,
            similarity: pdfFiles.find(pdf => pdf.isFuzzyMatch)?.similarity 
          });
        }
        
        this.results.extracted.push({ clientName, date, therapistName, row: rowIndex + 1 });
      } else {
        console.log(`No SOAP note found for ${clientName} on ${date}`);
        this.results.noCommentFound.push({ clientName, date, therapistName, row: rowIndex + 1, pdfNames: checkedPdfNames });
      }
      
    } catch (error) {
      console.error(`Error processing ${clientName} - ${date}:`, error);
      this.results.errors.push({ clientName, date, therapistName, row: rowIndex + 1, error: error.message });
    }
  }

  async run() {
    try {
      console.log('Starting SOAP notes extraction...');
      
      // First authorize
      await this.authorize();
      
      const sheetData = await this.getSheetData();
      
      // Start from row 1009 (index 1008 since array is 0-indexed)
      const startRow = 1008;
      console.log(`Starting from row ${startRow + 1}...`);
      
      // Process all rows from start row to end
      // Only process rows that don't already have SOAP notes
      for (let i = startRow; i < sheetData.length; i++) {
        const row = sheetData[i];
        const existingSoapNote = row[15]; // Column P (0-indexed)
        
        // Skip if SOAP note already exists
        if (!existingSoapNote) {
          await this.processRow(i, row);
        }
      }
      
      console.log('SOAP notes extraction completed!');
      
      // Generate and save report
      this.generateReport();
      
      // Send email report
      await this.sendEmailReport();
      
    } catch (error) {
      console.error('Error in main process:', error);
    }
  }

  generateReport() {
    console.log('\n=== SOAP NOTES EXTRACTION REPORT ===');
    console.log(`✅ Successfully extracted: ${this.results.extracted.length} SOAP notes`);
    console.log(`❌ No PDF found: ${this.results.noPdfFound.length} clients`);
    console.log(`⚠️  No comment found: ${this.results.noCommentFound.length} sessions`);
    console.log(`🔍 Fuzzy matches used: ${this.results.fuzzyMatches.length} extractions (VERIFY THESE)`);
    console.log(`🚫 Errors: ${this.results.errors.length} issues`);
    
    // Organize results by therapist
    const organizeByTherapist = (items) => {
      const byTherapist = {};
      items.forEach(item => {
        const therapist = item.therapistName || 'Unknown';
        if (!byTherapist[therapist]) {
          byTherapist[therapist] = [];
        }
        byTherapist[therapist].push(item);
      });
      return byTherapist;
    };

    const organizedResults = {
      extracted: organizeByTherapist(this.results.extracted),
      noPdfFound: organizeByTherapist(this.results.noPdfFound),
      noCommentFound: organizeByTherapist(this.results.noCommentFound),
      fuzzyMatches: organizeByTherapist(this.results.fuzzyMatches),
      errors: organizeByTherapist(this.results.errors)
    };
    
    // Write detailed report to file
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        extracted: this.results.extracted.length,
        noPdfFound: this.results.noPdfFound.length,
        noCommentFound: this.results.noCommentFound.length,
        fuzzyMatches: this.results.fuzzyMatches.length,
        errors: this.results.errors.length
      },
      details: this.results,
      byTherapist: organizedResults
    };
    
    fs.writeFileSync('soap-notes-report.json', JSON.stringify(reportData, null, 2));
    console.log('📄 Detailed report saved to soap-notes-report.json');
    
    // Print missing SOAP notes organized by therapist
    if (this.results.noCommentFound.length > 0) {
      console.log('\n=== MISSING SOAP NOTES BY THERAPIST ===');
      Object.keys(organizedResults.noCommentFound).sort().forEach(therapist => {
        console.log(`\n👨‍⚕️ ${therapist} (${organizedResults.noCommentFound[therapist].length} missing):`);
        organizedResults.noCommentFound[therapist].forEach(item => {
          const pdfInfo = item.pdfNames ? `PDFs: ${item.pdfNames.join(', ')}` : 'No PDFs';
          console.log(`  Row ${item.row}: ${item.clientName} - ${item.date} (${pdfInfo})`);
        });
      });
    }
    
    if (this.results.fuzzyMatches.length > 0) {
      console.log('\n=== FUZZY MATCHES USED (VERIFY THESE) ===');
      Object.keys(organizedResults.fuzzyMatches).sort().forEach(therapist => {
        console.log(`\n👨‍⚕️ ${therapist} (${organizedResults.fuzzyMatches[therapist].length} fuzzy matches):`);
        organizedResults.fuzzyMatches[therapist].forEach(item => {
          console.log(`  Row ${item.row}: ${item.clientName} - ${item.date}`);
          console.log(`    📁 Matched PDF(s): ${item.pdfNames.join(', ')}`);
          console.log(`    📊 Similarity: ${((item.similarity || 0) * 100).toFixed(1)}%`);
        });
      });
    }

    if (this.results.noPdfFound.length > 0) {
      console.log('\n=== NO PDF FOUND BY THERAPIST ===');
      Object.keys(organizedResults.noPdfFound).sort().forEach(therapist => {
        console.log(`\n👨‍⚕️ ${therapist} (${organizedResults.noPdfFound[therapist].length} missing PDFs):`);
        organizedResults.noPdfFound[therapist].forEach(item => {
          console.log(`  Row ${item.row}: ${item.clientName} - ${item.date}`);
        });
      });
    }
  }

  async sendEmailReport() {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        attempt++;
        console.log(`📧 Attempting to send email report (attempt ${attempt}/${maxRetries})...`);
        
        // Create transporter
        const transporter = nodemailer.createTransport({
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          secure: false, // true for 465, false for other ports
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        // Create email content
        const subject = `SOAP Notes Extraction Report - ${new Date().toLocaleDateString()}`;
        
        let emailBody = `
SOAP Notes Extraction Report
Generated: ${new Date().toLocaleString()}

SUMMARY:
✅ Successfully extracted: ${this.results.extracted.length} SOAP notes
❌ No PDF found: ${this.results.noPdfFound.length} clients
⚠️  No comment found: ${this.results.noCommentFound.length} sessions
🔍 Fuzzy matches used: ${this.results.fuzzyMatches.length} extractions (VERIFY THESE)
🚫 Errors: ${this.results.errors.length} issues

`;

        // Organize results by therapist for email
        const organizeByTherapist = (items) => {
          const byTherapist = {};
          items.forEach(item => {
            const therapist = item.therapistName || 'Unknown';
            if (!byTherapist[therapist]) {
              byTherapist[therapist] = [];
            }
            byTherapist[therapist].push(item);
          });
          return byTherapist;
        };

        // Add missing SOAP notes details organized by therapist
        if (this.results.noCommentFound.length > 0) {
          emailBody += `\nMISSING SOAP NOTES BY THERAPIST (${this.results.noCommentFound.length} total):\n`;
          const byTherapist = organizeByTherapist(this.results.noCommentFound);
          Object.keys(byTherapist).sort().forEach(therapist => {
            emailBody += `\n🔸 ${therapist} (${byTherapist[therapist].length} missing):\n`;
            byTherapist[therapist].forEach(item => {
              emailBody += `  • Row ${item.row}: ${item.clientName} - ${item.date}\n`;
            });
          });
        }

        // Add fuzzy matches details organized by therapist
        if (this.results.fuzzyMatches.length > 0) {
          emailBody += `\nFUZZY MATCHES USED - VERIFY THESE (${this.results.fuzzyMatches.length} total):\n`;
          const byTherapist = organizeByTherapist(this.results.fuzzyMatches);
          Object.keys(byTherapist).sort().forEach(therapist => {
            emailBody += `\n🔸 ${therapist} (${byTherapist[therapist].length} fuzzy matches):\n`;
            byTherapist[therapist].forEach(item => {
              emailBody += `  • Row ${item.row}: ${item.clientName} - ${item.date}\n`;
              emailBody += `    📁 PDF: ${item.pdfNames.join(', ')}\n`;
              emailBody += `    📊 Similarity: ${((item.similarity || 0) * 100).toFixed(1)}%\n`;
            });
          });
        }

        // Add no PDF found details organized by therapist
        if (this.results.noPdfFound.length > 0) {
          emailBody += `\nNO PDF FOUND BY THERAPIST (${this.results.noPdfFound.length} total):\n`;
          const byTherapist = organizeByTherapist(this.results.noPdfFound);
          Object.keys(byTherapist).sort().forEach(therapist => {
            emailBody += `\n🔸 ${therapist} (${byTherapist[therapist].length} missing PDFs):\n`;
            byTherapist[therapist].forEach(item => {
              emailBody += `  • Row ${item.row}: ${item.clientName} - ${item.date}\n`;
            });
          });
        }

        // Add errors if any organized by therapist
        if (this.results.errors.length > 0) {
          emailBody += `\nERRORS BY THERAPIST (${this.results.errors.length} total):\n`;
          const byTherapist = organizeByTherapist(this.results.errors);
          Object.keys(byTherapist).sort().forEach(therapist => {
            emailBody += `\n🔸 ${therapist} (${byTherapist[therapist].length} errors):\n`;
            byTherapist[therapist].forEach(item => {
              emailBody += `  • Row ${item.row}: ${item.clientName} - ${item.date} - ${item.error}\n`;
            });
          });
        }

        emailBody += `\nDetailed report saved to: soap-notes-report.json`;

        // Send email
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_TO,
          subject: subject,
          text: emailBody
        });

        console.log('✅ Email report sent successfully!');
        return; // Success - exit the retry loop
        
      } catch (error) {
        console.error(`❌ Email send attempt ${attempt} failed:`, error.message);
        
        if (attempt >= maxRetries) {
          console.error('🚨 CRITICAL: Email report failed after all retry attempts!');
          console.error('🚨 Please check your email configuration and network connection.');
          console.error('🚨 Report data is still saved to soap-notes-report.json');
        } else {
          console.log(`⏳ Waiting 5 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        }
      }
    }
  }
}

// Export the class for use in scheduler
module.exports = { SoapNotesExtractor };

// Only run if this file is executed directly
if (require.main === module) {
  const extractor = new SoapNotesExtractor();
  extractor.run();
}
