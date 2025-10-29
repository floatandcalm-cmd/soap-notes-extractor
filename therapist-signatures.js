const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];

const THERAPIST_MAPPING = {
  // Code/Name patterns mapped to full therapist info
  'GH': { name: 'Gemma Hernandez', npi: '1336958990', signature: 'Gemma.png' },
  'Gemma': { name: 'Gemma Hernandez', npi: '1336958990', signature: 'Gemma.png' },
  'CS': { name: 'Catie Stevens', npi: '1962211730', signature: 'Catie.jpg' },
  'Catie': { name: 'Catie Stevens', npi: '1962211730', signature: 'Catie.jpg' },
  'LG': { name: 'Lili Gutierrez', npi: '1982482113', signature: 'Lili.jpeg' },
  'Lili': { name: 'Lili Gutierrez', npi: '1982482113', signature: 'Lili.jpeg' },
  'Paula': { name: 'Paula Reyes', npi: '1831950021', signature: 'Paula.png' },
  'PR': { name: 'Paula Reyes', npi: '1831950021', signature: 'Paula.png' },
  'paula': { name: 'Paula Reyes', npi: '1831950021', signature: 'Paula.png' },
  'Brittany': { name: 'Brittany Coy', npi: '1477395093', signature: 'Brittany.jpeg' },
  'MM': { name: 'Marco Martinez', npi: '1750191185', signature: 'Marco.png' },
  'Marco': { name: 'Marco Martinez', npi: '1750191185', signature: 'Marco.png' },
  'RM': { name: 'Robert Martinez', npi: '1396554432', signature: 'Robert.png' },
  'Robert': { name: 'Robert Martinez', npi: '1396554432', signature: 'Robert.png' },
  'Alan': { name: 'Alan Infante', npi: '1932999778', signature: 'Alan.png' },
  'JF': { name: 'Julia Flores', npi: '1427930429', signature: 'Julia.png' },
  'Julia': { name: 'Julia Flores', npi: '1427930429', signature: 'Julia.png' },
  'BI': { name: 'Bianca Ingram', npi: '1770466443', signature: 'Bianca.png' },
  'Bianca': { name: 'Bianca Ingram', npi: '1770466443', signature: 'Bianca.png' }
};

class TherapistSignatureProcessor {
  constructor() {
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    this.docs = google.docs({ version: 'v1', auth: this.oAuth2Client });
    this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
  }

  async authorize() {
    // Use the same authorization as the SOAP notes extractor
    try {
      const fs = require('fs');
      const token = fs.readFileSync('token.json');
      this.oAuth2Client.setCredentials(JSON.parse(token));
      return;
    } catch (error) {
      console.log('Please run the SOAP notes extractor first to authorize');
      throw new Error('Not authorized - run main SOAP extractor first');
    }
  }

  extractTherapistFromContent(content) {
    console.log('Extracting therapist from content...');
    
    // Split content into lines and look for therapist names in specific contexts
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and common non-therapist patterns
      if (!trimmedLine || trimmedLine.startsWith('S:') || trimmedLine.startsWith('O:') || 
          trimmedLine.startsWith('A:') || trimmedLine.startsWith('P:')) {
        continue;
      }
      
      // Look for therapist patterns in specific contexts
      for (const [key, therapist] of Object.entries(THERAPIST_MAPPING)) {
        const keyLower = key.toLowerCase();
        const lineLower = trimmedLine.toLowerCase();
        
        // Pattern 1: Date followed by therapist code (e.g., "8/21/25 LG 60 min")
        const dateTherapistPattern = new RegExp(`\\d{1,2}/\\d{1,2}/\\d{2,4}\\s+${keyLower}(?:\\s|$)`, 'i');
        if (dateTherapistPattern.test(lineLower)) {
          console.log(`Found therapist: ${therapist.name} (matched "${key}" in date pattern: "${trimmedLine}")`);
          return therapist;
        }
        
        // Pattern 2: Standalone therapist name on its own line
        if (lineLower === keyLower) {
          console.log(`Found therapist: ${therapist.name} (matched "${key}" as standalone: "${trimmedLine}")`);
          return therapist;
        }
        
        // Pattern 3: "Therapist:" followed by name (e.g., "therapist: lili gutierrez")
        if (lineLower.includes('therapist:') && lineLower.includes(keyLower)) {
          console.log(`Found therapist: ${therapist.name} (matched "${key}" in therapist label: "${trimmedLine}")`);
          return therapist;
        }
        
        // Pattern 4: LMT followed by name (e.g., "LMT Ana", "08/08/25 Lmt Julia")
        const lmtPattern = new RegExp(`\\blmt\\s+${keyLower}(?:\\s|$)`, 'i');
        if (lmtPattern.test(lineLower)) {
          console.log(`Found therapist: ${therapist.name} (matched "${key}" in LMT pattern: "${trimmedLine}")`);
          return therapist;
        }
        
        // Pattern 5: Therapist code at start of line (e.g., "GH 8/14/2025")
        if (lineLower.startsWith(keyLower + ' ') || lineLower.startsWith(keyLower + '\t')) {
          console.log(`Found therapist: ${therapist.name} (matched "${key}" at line start: "${trimmedLine}")`);
          return therapist;
        }
      }
      
      // If we've gone through many lines without finding a therapist, stop
      if (lines.indexOf(line) > 15) break;
    }
    
    console.log('No therapist found in content');
    return null;
  }

  async findSignatureImage(signatureFileName) {
    try {
      console.log(`Looking for signature file: ${signatureFileName}`);
      
      // First find the signatures folder
      const folderResponse = await this.drive.files.list({
        q: "name='signatures' and mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name)'
      });
      
      if (folderResponse.data.files.length === 0) {
        throw new Error('Signatures folder not found');
      }
      
      const signaturesFolderId = folderResponse.data.files[0].id;
      console.log(`Found signatures folder: ${signaturesFolderId}`);
      
      // Now search for the signature file in that folder
      const fileResponse = await this.drive.files.list({
        q: `name='${signatureFileName}' and parents in '${signaturesFolderId}'`,
        fields: 'files(id, name, mimeType)'
      });
      
      if (fileResponse.data.files.length === 0) {
        throw new Error(`Signature file ${signatureFileName} not found in signatures folder`);
      }
      
      const signatureFile = fileResponse.data.files[0];
      console.log(`Found signature file: ${signatureFile.name} (${signatureFile.id})`);
      
      return signatureFile;
      
    } catch (error) {
      console.error('Error finding signature image:', error);
      throw error;
    }
  }

  async processDocument(documentId) {
    try {
      console.log(`Processing document: ${documentId}`);
      
      // Get the document content
      const doc = await this.docs.documents.get({
        documentId: documentId
      });
      
      console.log(`Document title: ${doc.data.title}`);
      
      // Extract text content
      let textContent = '';
      if (doc.data.body && doc.data.body.content) {
        for (const element of doc.data.body.content) {
          if (element.paragraph && element.paragraph.elements) {
            for (const textElement of element.paragraph.elements) {
              if (textElement.textRun && textElement.textRun.content) {
                textContent += textElement.textRun.content;
              }
            }
          }
        }
      }
      
      console.log(`Extracted text content (${textContent.length} chars)`);
      
      // Extract therapist from content
      const therapist = this.extractTherapistFromContent(textContent);
      
      if (!therapist) {
        console.log('No therapist found - skipping document');
        return { success: false, reason: 'No therapist found' };
      }
      
      // Skip duplicate check - always add signature
      // (Comment out the duplicate check as requested)
      // if (textContent.includes(therapist.name) && textContent.includes(therapist.npi)) {
      //   console.log('Document already has therapist signature - skipping');
      //   return { success: false, reason: 'Already signed' };
      // }
      
      // Find signature image
      const signatureFile = await this.findSignatureImage(therapist.signature);
      
      // Add therapist name, NPI, and signature to document
      await this.addTherapistSignature(documentId, therapist, signatureFile);
      
      console.log(`✅ Successfully added signature for ${therapist.name}`);
      return { success: true, therapist: therapist.name };
      
    } catch (error) {
      console.error('Error processing document:', error);
      throw error;
    }
  }

  async addTherapistSignature(documentId, therapist, signatureFile) {
    try {
      console.log(`Adding signature for ${therapist.name}...`);
      
      // Get current document to find the end
      const doc = await this.docs.documents.get({
        documentId: documentId
      });
      
      // Find the end index of the document
      const endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex - 1;
      
      // Prepare the signature text
      const signatureText = `\n\nTherapist: ${therapist.name}  NPI: ${therapist.npi}`;
      
      // First, insert the text
      await this.docs.documents.batchUpdate({
        documentId: documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: endIndex },
                text: signatureText
              }
            }
          ]
        }
      });
      
      // Get updated document to find new end index
      const updatedDoc = await this.docs.documents.get({
        documentId: documentId
      });
      
      const newEndIndex = updatedDoc.data.body.content[updatedDoc.data.body.content.length - 1].endIndex - 1;
      
      // Now insert the image after the text
      await this.docs.documents.batchUpdate({
        documentId: documentId,
        requestBody: {
          requests: [
            {
              insertInlineImage: {
                location: { index: newEndIndex },
                uri: `https://drive.google.com/uc?id=${signatureFile.id}`,
                objectSize: {
                  height: { magnitude: 60, unit: 'PT' },
                  width: { magnitude: 200, unit: 'PT' }
                }
              }
            }
          ]
        }
      });
      
      console.log('✅ Signature added successfully');
      
    } catch (error) {
      console.error('Error adding signature:', error);
      throw error;
    }
  }
}

module.exports = { TherapistSignatureProcessor, THERAPIST_MAPPING };