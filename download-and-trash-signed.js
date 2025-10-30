// Download signed documents as PDFs and move them to trash
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Dropbox } = require('dropbox');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];

class DocumentProcessor {
  constructor() {
    // Initialize Dropbox client if token is available
    if (process.env.DROPBOX_ACCESS_TOKEN) {
      this.dropbox = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
      console.log('Dropbox API initialized');
    } else {
      console.log('No Dropbox token found - will use local file system');
    }

    // Prefer service account if configured; fall back to OAuth2 token.json
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        let credentials;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
          const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
          const fullPath = keyPath.startsWith('/') ? keyPath : `${__dirname}/${keyPath}`;
          credentials = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        } else {
          credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        }
        this.authClient = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
        this.docs = google.docs({ version: 'v1', auth: this.authClient });
        this.drive = google.drive({ version: 'v3', auth: this.authClient });
        return;
      } catch (err) {
        // Fall back to OAuth2 below
        console.log('Service account not usable, falling back to OAuth2:', err.message);
      }
    }

    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.docs = google.docs({ version: 'v1', auth: this.oAuth2Client });
    this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
  }

  async authorize() {
    // If using service account, nothing to do
    if (this.authClient) return;
    // If env indicates service account, try to initialize now
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        let credentials;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
          const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
          const fullPath = keyPath.startsWith('/') ? keyPath : `${__dirname}/${keyPath}`;
          credentials = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        } else {
          credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        }
        this.authClient = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
        this.docs = google.docs({ version: 'v1', auth: this.authClient });
        this.drive = google.drive({ version: 'v3', auth: this.authClient });
        return;
      } catch (e) {
        // fall through to OAuth2 token
      }
    }
    try {
      const token = fs.readFileSync('token.json');
      this.oAuth2Client.setCredentials(JSON.parse(token));
    } catch (error) {
      throw new Error('Not authorized - token.json missing. Configure service account or OAuth.');
    }
  }

  async findSignedDocuments() {
    try {
      console.log('=== FINDING SIGNED DOCUMENTS ===');
      
      // First find the "soap notes for vets" folder
      const folderResponse = await this.drive.files.list({
        q: "name='soap notes for vets' and mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name)'
      });
      
      if (folderResponse.data.files.length === 0) {
        throw new Error('SOAP notes for vets folder not found');
      }
      
      const soapFolderId = folderResponse.data.files[0].id;
      console.log(`Found SOAP notes folder: ${soapFolderId}`);
      
      // Get Google Docs from the SOAP notes folder
      const docs = await this.drive.files.list({
        q: `mimeType='application/vnd.google-apps.document' and parents in '${soapFolderId}' and trashed=false`,
        orderBy: 'modifiedTime desc',
        fields: 'files(id, name, modifiedTime)',
        pageSize: 100
      });
      
      const signedDocs = [];
      
      for (const doc of docs.data.files) {
        try {
          // Get document content
          const docData = await this.docs.documents.get({
            documentId: doc.id
          });
          
          // Extract text content
          let textContent = '';
          if (docData.data.body && docData.data.body.content) {
            for (const element of docData.data.body.content) {
              if (element.paragraph && element.paragraph.elements) {
                for (const textElement of element.paragraph.elements) {
                  if (textElement.textRun && textElement.textRun.content) {
                    textContent += textElement.textRun.content;
                  }
                }
              }
            }
          }
          
          // Check if document has our signature format
          const hasSignature = textContent.includes('Therapist:') && textContent.includes('NPI:');
          
          if (hasSignature) {
            console.log(`✅ Found signed document: ${doc.name}`);
            signedDocs.push({
              id: doc.id,
              name: doc.name,
              modifiedTime: doc.modifiedTime
            });
          }
          
        } catch (error) {
          console.log(`⚠️ Error checking ${doc.name}: ${error.message}`);
        }
      }
      
      console.log(`Found ${signedDocs.length} signed documents`);
      return signedDocs;
      
    } catch (error) {
      console.error('Error finding signed documents:', error);
      throw error;
    }
  }

  async downloadDocumentAsPDF(docId, fileName) {
    try {
      console.log(`Downloading ${fileName} as PDF...`);
      
      // Export document as PDF
      const response = await this.drive.files.export({
        fileId: docId,
        mimeType: 'application/pdf'
      }, { responseType: 'arraybuffer' });
      
      // Create downloads directory if it doesn't exist
      const downloadsDir = path.join(__dirname, 'downloaded_pdfs');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
      }
      
      // Save PDF file
      const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const pdfPath = path.join(downloadsDir, `${safeName}.pdf`);
      
      fs.writeFileSync(pdfPath, Buffer.from(response.data));
      console.log(`✅ Downloaded: ${pdfPath}`);
      
      return pdfPath;
      
    } catch (error) {
      console.error(`Error downloading ${fileName}:`, error.message);
      throw error;
    }
  }

  async moveToTrash(docId, fileName) {
    try {
      console.log(`Moving ${fileName} to trash...`);
      
      await this.drive.files.update({
        fileId: docId,
        requestBody: {
          trashed: true
        }
      });
      
      console.log(`🗑️ Moved to trash: ${fileName}`);
      
    } catch (error) {
      console.error(`Error moving ${fileName} to trash:`, error.message);
      throw error;
    }
  }

  async processSignedDocuments() {
    try {
      console.log('=== PROCESSING SIGNED DOCUMENTS ===');
      
      // Find all signed documents
      const signedDocs = await this.findSignedDocuments();
      
      if (signedDocs.length === 0) {
        console.log('No signed documents found');
        return;
      }
      
      let downloaded = 0;
      let trashed = 0;
      let errors = 0;
      
      for (const doc of signedDocs) {
        try {
          console.log(`\n--- Processing: ${doc.name} ---`);
          
          // Download as PDF
          await this.downloadDocumentAsPDF(doc.id, doc.name);
          downloaded++;
          
          // Move to trash
          await this.moveToTrash(doc.id, doc.name);
          trashed++;
          
          // Small delay between operations
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`❌ Error processing ${doc.name}: ${error.message}`);
          errors++;
        }
      }
      
      console.log('\n=== PROCESSING COMPLETE ===');
      console.log(`📥 Downloaded: ${downloaded} PDFs`);
      console.log(`🗑️ Moved to trash: ${trashed} documents`);
      console.log(`❌ Errors: ${errors}`);
      
      if (downloaded > 0) {
        console.log(`\n📁 PDF files saved to: ${path.join(__dirname, 'downloaded_pdfs')}`);
        
        // Move PDFs to Dropbox
        console.log(`\n=== MOVING TO DROPBOX ===`);
        await this.moveToDropbox();
        
        // Generate Excel list of downloaded files (before organizing)
        console.log(`\n=== GENERATING EXCEL LIST ===`);
        await this.createExcelList();
        
        // Organize PDFs into patient folders
        console.log(`\n=== ORGANIZING INTO PATIENT FOLDERS ===`);
        await this.organizeIntoPatientFolders();
      }
      
    } catch (error) {
      console.error('Error processing signed documents:', error);
    }
  }

  async moveToDropbox() {
    try {
      const downloadDir = path.join(__dirname, 'downloaded_pdfs');

      if (!fs.existsSync(downloadDir)) {
        console.log('No download directory found');
        return;
      }

      const files = fs.readdirSync(downloadDir);
      const pdfFiles = files.filter(file => file.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        console.log('No PDF files to upload to Dropbox');
        return;
      }

      // Use Dropbox API if available, otherwise use local file system
      if (this.dropbox) {
        await this.moveToDropboxAPI(pdfFiles, downloadDir);
      } else {
        await this.moveToDropboxLocal(pdfFiles, downloadDir);
      }

    } catch (error) {
      console.error('Error moving files to Dropbox:', error);
    }
  }

  async moveToDropboxAPI(pdfFiles, downloadDir) {
    const dropboxPath = '/Soap Notes';
    let movedCount = 0;

    for (const file of pdfFiles) {
      const sourcePath = path.join(downloadDir, file);
      const dropboxFilePath = `${dropboxPath}/${file}`;

      try {
        // Check if file already exists in Dropbox
        try {
          await this.dropbox.filesGetMetadata({ path: dropboxFilePath });
          console.log(`⚠️  File already exists in Dropbox: ${file}`);
          // Remove from local downloads since it's already in Dropbox
          fs.unlinkSync(sourcePath);
          continue;
        } catch (error) {
          // File doesn't exist, proceed with upload
          if (error.status !== 409) {
            throw error;
          }
        }

        // Upload file to Dropbox
        const fileContent = fs.readFileSync(sourcePath);
        await this.dropbox.filesUpload({
          path: dropboxFilePath,
          contents: fileContent,
          mode: 'add',
          autorename: false
        });

        console.log(`✅ Uploaded to Dropbox: ${file}`);
        movedCount++;

        // Remove local file after successful upload
        fs.unlinkSync(sourcePath);

      } catch (error) {
        console.error(`❌ Error uploading ${file}:`, error.message);
      }
    }

    console.log(`📦 Total files uploaded to Dropbox: ${movedCount}`);
  }

  async moveToDropboxLocal(pdfFiles, downloadDir) {
    const dropboxDir = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Soap Notes';

    if (!fs.existsSync(dropboxDir)) {
      console.error('Dropbox soap notes folder not found:', dropboxDir);
      return;
    }

    let movedCount = 0;

    for (const file of pdfFiles) {
      const sourcePath = path.join(downloadDir, file);
      const destPath = path.join(dropboxDir, file);

      try {
        // Check if file already exists in Dropbox
        if (fs.existsSync(destPath)) {
          console.log(`⚠️  File already exists in Dropbox: ${file}`);
          // Remove from local downloads since it's already in Dropbox
          fs.unlinkSync(sourcePath);
        } else {
          // Move file to Dropbox
          fs.renameSync(sourcePath, destPath);
          console.log(`✅ Moved to Dropbox: ${file}`);
          movedCount++;
        }
      } catch (error) {
        console.error(`❌ Error moving ${file}:`, error.message);
      }
    }

    console.log(`📦 Total files moved to Dropbox: ${movedCount}`);
  }

  async createExcelList() {
    try {
      const XLSX = require('xlsx');
      
      // Get all PDF files from the Veterans soap directory (after organizing)
      const veteransDir = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Veterans soap';
      
      if (!fs.existsSync(veteransDir)) {
        console.log('Veterans soap directory not found');
        return;
      }
      
      // Recursively find all PDF files in patient folders
      const getAllPDFs = (dir) => {
        let pdfFiles = [];
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stats = fs.statSync(fullPath);
          
          if (stats.isDirectory()) {
            pdfFiles = pdfFiles.concat(getAllPDFs(fullPath));
          } else if (item.endsWith('.pdf')) {
            pdfFiles.push(fullPath);
          }
        }
        return pdfFiles;
      };
      
      const pdfFiles = getAllPDFs(veteransDir);
      
      if (pdfFiles.length === 0) {
        console.log('No PDF files found in Dropbox directory');
        return;
      }
      
      console.log(`Found ${pdfFiles.length} PDF files in Dropbox for Excel list`);
      
      // Create data array for Excel
      const data = [];
      data.push(['Client Name', 'Date', 'Filename', 'File Size (KB)', 'Dropbox Path']);
      
      // Process each PDF file
      pdfFiles.forEach((filePath) => {
        const stats = fs.statSync(filePath);
        const fileSizeKB = Math.round(stats.size / 1024);
        const filename = path.basename(filePath);
        const patientFolder = path.basename(path.dirname(filePath));
        
        // Parse filename to extract client info
        const nameWithoutExt = filename.replace('.pdf', '');
        const parts = nameWithoutExt.split('_');
        
        let clientName = patientFolder; // Use folder name as primary client name
        let date = '';
        
        if (parts.length >= 4) {
          const dateParts = parts.slice(-3);
          
          if (dateParts.length === 3 && 
              dateParts[0].match(/^\d{1,2}$/) && 
              dateParts[1].match(/^\d{1,2}$/) && 
              dateParts[2].match(/^\d{4}$/)) {
            
            date = `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}`;
          } else {
            date = 'Unknown';
          }
        } else {
          date = 'Unknown';
        }
        
        data.push([clientName, date, filename, fileSizeKB, filePath]);
      });
      
      // Sort by client name
      const sortedData = [data[0], ...data.slice(1).sort((a, b) => a[0].localeCompare(b[0]))];
      
      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(sortedData);
      
      // Set column widths
      worksheet['!cols'] = [
        { width: 25 }, { width: 12 }, { width: 40 }, { width: 12 }, { width: 80 }
      ];
      
      XLSX.utils.book_append_sheet(workbook, worksheet, 'SOAP Notes in Dropbox');
      
      // Write Excel file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const excelPath = path.join(__dirname, `SOAP_Notes_Dropbox_${timestamp}.xlsx`);
      XLSX.writeFile(workbook, excelPath);
      
      console.log(`✅ Excel list created: SOAP_Notes_Dropbox_${timestamp}.xlsx`);
      console.log(`📊 Total files listed: ${pdfFiles.length}`);
      console.log(`📂 Files are now stored in Dropbox soap notes folder`);
      
    } catch (error) {
      console.error('Error creating Excel list:', error);
    }
  }

  async organizeIntoPatientFolders() {
    try {
      console.log('Running organization into patient folders...');

      // Use Dropbox API if available, otherwise use local file system
      if (this.dropbox) {
        await this.organizeIntoPatientFoldersAPI();
      } else {
        await this.organizeIntoPatientFoldersLocal();
      }

    } catch (error) {
      console.error('Error organizing into patient folders:', error);
    }
  }

  async organizeIntoPatientFoldersAPI() {
    const soapNotesPath = '/Soap Notes';
    const veteransSoapPath = '/Veterans soap';

    // Get all PDF files from soap notes folder
    let pdfFiles = [];
    try {
      const result = await this.dropbox.filesListFolder({ path: soapNotesPath });
      pdfFiles = result.result.entries
        .filter(entry => entry['.tag'] === 'file' && entry.name.endsWith('.pdf'))
        .map(entry => entry.name);
    } catch (error) {
      console.log('No PDF files found in Soap Notes folder or folder does not exist');
      return;
    }

    if (pdfFiles.length === 0) {
      console.log('No PDF files found in soap notes folder to organize');
      return;
    }

    console.log(`Found ${pdfFiles.length} PDF files to organize`);

    // Get all patient folders from veterans soap folder
    let veteransFolders = [];
    try {
      const result = await this.dropbox.filesListFolder({ path: veteransSoapPath });
      veteransFolders = result.result.entries
        .filter(entry => entry['.tag'] === 'folder')
        .map(entry => entry.name);
    } catch (error) {
      console.log('Veterans soap folder not found - will create as needed');
    }

    console.log(`Found ${veteransFolders.length} patient folders in veterans soap`);

    let processed = 0;
    let errors = 0;

    // Process each PDF file
    for (const pdfFile of pdfFiles) {
      try {
        console.log(`Processing: ${pdfFile}`);

        // Extract patient name from filename
        const nameWithoutExt = pdfFile.replace('.pdf', '');
        let patientName = '';

        // Try to parse standard format first
        const standardMatch = nameWithoutExt.match(/^(.+?)_(\d{1,2})_(\d{1,2})_(\d{4})$/);

        if (standardMatch) {
          patientName = standardMatch[1].replace(/_/g, ' ');
        } else {
          // If standard format fails, extract first word as name
          const parts = nameWithoutExt.split('_');
          patientName = parts[0];
        }

        console.log(`Patient name extracted: "${patientName}"`);

        // Find matching folder(s)
        const matchingFolders = veteransFolders.filter(folder => {
          const folderLower = folder.toLowerCase();
          const patientLower = patientName.toLowerCase();

          if (folderLower === patientLower) return true;

          const words = patientLower.split(' ');
          return words.every(word => {
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(folderLower);
          });
        });

        let targetFolder;
        if (matchingFolders.length > 0) {
          targetFolder = matchingFolders[0];
          console.log(`Found matching folder: ${targetFolder}`);
        } else {
          // Create new folder for patient
          console.log(`📁 No folder found for: ${patientName} - creating new folder`);
          targetFolder = patientName;

          try {
            await this.dropbox.filesCreateFolderV2({ path: `${veteransSoapPath}/${targetFolder}` });
            console.log(`✅ Created folder: ${targetFolder}`);
            veteransFolders.push(targetFolder);
          } catch (error) {
            if (error.error?.error['.tag'] !== 'path' || error.error?.error?.path['.tag'] !== 'conflict') {
              throw error;
            }
            console.log(`Folder already exists: ${targetFolder}`);
          }
        }

        // Move the file
        const sourcePath = `${soapNotesPath}/${pdfFile}`;
        const destPath = `${veteransSoapPath}/${targetFolder}/${pdfFile}`;

        await this.dropbox.filesMoveV2({
          from_path: sourcePath,
          to_path: destPath,
          autorename: false
        });

        console.log(`✅ Successfully moved: ${pdfFile} to ${targetFolder}`);
        processed++;

      } catch (error) {
        console.error(`❌ Error processing ${pdfFile}:`, error.message);
        errors++;
      }
    }

    console.log(`\n=== ORGANIZATION COMPLETE ===`);
    console.log(`✅ Successfully processed: ${processed} files`);
    console.log(`❌ Errors: ${errors} files`);
  }

  async organizeIntoPatientFoldersLocal() {
    const soapNotesFolder = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Soap Notes';
    const veteransSoapFolder = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Veterans soap';

    // Check if folders exist
    if (!fs.existsSync(soapNotesFolder)) {
      console.log(`SOAP notes folder not found: ${soapNotesFolder}`);
      return;
    }

    if (!fs.existsSync(veteransSoapFolder)) {
      console.log(`Veterans SOAP folder not found: ${veteransSoapFolder}`);
      return;
    }

    // Get all PDF files from soap notes folder
    const files = fs.readdirSync(soapNotesFolder);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.log('No PDF files found in soap notes folder to organize');
      return;
    }

    console.log(`Found ${pdfFiles.length} PDF files to organize`);

    // Get all patient folders from veterans soap folder
    const veteransFolders = fs.readdirSync(veteransSoapFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`Found ${veteransFolders.length} patient folders in veterans soap`);

    let processed = 0;
    let errors = 0;

    // Process each PDF file
    for (const pdfFile of pdfFiles) {
      try {
        console.log(`Processing: ${pdfFile}`);

        // Extract patient name from filename
        const nameWithoutExt = pdfFile.replace('.pdf', '');
        let patientName = '';

        // Try to parse standard format first
        const standardMatch = nameWithoutExt.match(/^(.+?)_(\d{1,2})_(\d{1,2})_(\d{4})$/);

        if (standardMatch) {
          patientName = standardMatch[1].replace(/_/g, ' ');
        } else {
          // If standard format fails, extract first word as name
          const parts = nameWithoutExt.split('_');
          patientName = parts[0];
        }

        console.log(`Patient name extracted: "${patientName}"`);

        // Find matching folder(s) - use word boundaries to avoid partial matches
        const matchingFolders = veteransFolders.filter(folder => {
          const folderLower = folder.toLowerCase();
          const patientLower = patientName.toLowerCase();

          // First try exact match
          if (folderLower === patientLower) return true;

          // Then try word boundary matches (avoid "ryan" matching "maryanne")
          const words = patientLower.split(' ');
          return words.every(word => {
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(folderLower);
          });
        });

        if (matchingFolders.length > 0) {
          console.log(`Found ${matchingFolders.length} matching folders:`, matchingFolders.join(', '));

          // Use the first matching folder
          const targetFolder = matchingFolders[0];
          console.log(`Target folder: ${targetFolder}`);

          const sourcePath = path.join(soapNotesFolder, pdfFile);
          const destPath = path.join(veteransSoapFolder, targetFolder, pdfFile);

          console.log(`Moving to: ${path.join(veteransSoapFolder, targetFolder)}`);

          // Move the file
          fs.renameSync(sourcePath, destPath);
          console.log(`✅ Successfully moved: ${pdfFile}`);
          processed++;

        } else {
          // Create new folder for patient
          console.log(`📁 No folder found for: ${patientName} - creating new folder`);
          const newFolderPath = path.join(veteransSoapFolder, patientName);

          if (!fs.existsSync(newFolderPath)) {
            fs.mkdirSync(newFolderPath);
            console.log(`✅ Created folder: ${patientName}`);
          }

          const sourcePath = path.join(soapNotesFolder, pdfFile);
          const destPath = path.join(newFolderPath, pdfFile);

          console.log(`Moving to newly created folder: ${patientName}`);
          fs.renameSync(sourcePath, destPath);
          console.log(`✅ Successfully moved: ${pdfFile}`);
          processed++;
        }

      } catch (error) {
        console.error(`❌ Error processing ${pdfFile}:`, error.message);
        errors++;
      }
    }

    console.log(`\n=== ORGANIZATION COMPLETE ===`);
    console.log(`✅ Successfully processed: ${processed} files`);
    console.log(`❌ Errors: ${errors} files`);
  }
}

async function main() {
  const processor = new DocumentProcessor();
  
  try {
    await processor.authorize();
    await processor.processSignedDocuments();
  } catch (error) {
    console.error('Failed to process documents:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { DocumentProcessor };
