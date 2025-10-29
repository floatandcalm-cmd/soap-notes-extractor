// Process all unsigned documents to add therapist signatures
const { google } = require('googleapis');
const fs = require('fs');
const { TherapistSignatureProcessor } = require('./therapist-signatures');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function processAllUnsigned() {
  const processor = new TherapistSignatureProcessor();
  
  try {
    console.log('=== PROCESSING ALL UNSIGNED DOCUMENTS ===');
    
    // Authorize
    await processor.authorize();
    
    // First find the "soap notes for vets" folder
    const folderResponse = await processor.drive.files.list({
      q: "name='soap notes for vets' and mimeType='application/vnd.google-apps.folder'",
      fields: 'files(id, name)'
    });
    
    if (folderResponse.data.files.length === 0) {
      throw new Error('SOAP notes for vets folder not found');
    }
    
    const soapFolderId = folderResponse.data.files[0].id;
    console.log(`Found SOAP notes folder: ${soapFolderId}`);
    
    // Get all Google Docs from the SOAP notes folder
    const allDocs = await processor.drive.files.list({
      q: `mimeType='application/vnd.google-apps.document' and parents in '${soapFolderId}' and trashed=false`,
      orderBy: 'modifiedTime desc',
      fields: 'files(id, name, modifiedTime)',
      pageSize: 100
    });
    
    console.log(`Found ${allDocs.data.files.length} documents to check`);
    
    const unsigned = [];
    
    // First, identify unsigned documents
    for (const doc of allDocs.data.files) {
      try {
        // Get document content
        const docData = await processor.docs.documents.get({
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
        
        // Check if document has signature
        const hasSignature = textContent.includes('Therapist:') && textContent.includes('NPI:');
        
        if (!hasSignature) {
          unsigned.push({
            id: doc.id,
            name: doc.name,
            content: textContent
          });
        }
        
      } catch (error) {
        console.log(`⚠️ Error checking ${doc.name}: ${error.message}`);
      }
    }
    
    console.log(`\nFound ${unsigned.length} unsigned documents to process`);
    
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process each unsigned document
    for (const doc of unsigned) {
      try {
        console.log(`\n--- Processing: ${doc.name} ---`);
        
        const result = await processor.processDocument(doc.id);
        
        if (result.success) {
          console.log(`✅ SUCCESS! Added signature for ${result.therapist}`);
          processed++;
        } else {
          console.log(`⏭️ Skipped: ${result.reason}`);
          skipped++;
        }
        
        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Error processing ${doc.name}: ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n=== PROCESSING COMPLETE ===');
    console.log(`✅ Processed: ${processed} documents`);
    console.log(`⏭️ Skipped: ${skipped} documents`);
    console.log(`❌ Errors: ${errors} documents`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

processAllUnsigned();
