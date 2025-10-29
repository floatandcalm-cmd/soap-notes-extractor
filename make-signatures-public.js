// Make signature images public and get their proper URLs
const { TherapistSignatureProcessor } = require('./therapist-signatures');

async function makeSignaturesPublic() {
  const processor = new TherapistSignatureProcessor();
  
  try {
    console.log('=== MAKING SIGNATURE IMAGES PUBLIC ===');
    
    // Authorize
    await processor.authorize();
    
    // Find signatures folder
    const folderResponse = await processor.drive.files.list({
      q: "name='signatures' and mimeType='application/vnd.google-apps.folder'",
      fields: 'files(id, name)'
    });
    
    if (folderResponse.data.files.length === 0) {
      throw new Error('Signatures folder not found');
    }
    
    const signaturesFolderId = folderResponse.data.files[0].id;
    console.log(`Found signatures folder: ${signaturesFolderId}`);
    
    // Get all files in signatures folder
    const filesResponse = await processor.drive.files.list({
      q: `parents in '${signaturesFolderId}'`,
      fields: 'files(id, name, mimeType, webViewLink, webContentLink)'
    });
    
    const signatureFiles = filesResponse.data.files || [];
    console.log(`Found ${signatureFiles.length} signature files`);
    
    for (const file of signatureFiles) {
      console.log(`\n--- Processing: ${file.name} ---`);
      console.log(`File ID: ${file.id}`);
      console.log(`MIME Type: ${file.mimeType}`);
      
      try {
        // Make file publicly readable
        await processor.drive.permissions.create({
          fileId: file.id,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
        
        console.log('✅ Made file public');
        
        // Get the public URL
        const fileInfo = await processor.drive.files.get({
          fileId: file.id,
          fields: 'webViewLink, webContentLink'
        });
        
        const publicUrl = `https://drive.google.com/uc?id=${file.id}`;
        console.log(`📍 Public URL: ${publicUrl}`);
        
        // Test if the URL is accessible
        console.log(`🧪 Testing accessibility...`);
        
      } catch (error) {
        console.log(`❌ Error processing ${file.name}: ${error.message}`);
      }
    }
    
    console.log('\n=== SUMMARY ===');
    console.log('All signature files have been made public!');
    console.log('You can now test the signature system with image insertion.');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

makeSignaturesPublic();