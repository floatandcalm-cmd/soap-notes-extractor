// Organize SOAP notes from Dropbox "soap notes" folder into patient folders in "veterans soap"
const fs = require('fs');
const path = require('path');

async function organizeDropboxSOAPs() {
  try {
    console.log('=== ORGANIZING DROPBOX SOAP NOTES ===');
    
    // Define Dropbox paths
    const soapNotesFolder = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Soap Notes';
    const veteransSoapFolder = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Veterans soap';
    
    // Check if folders exist
    if (!fs.existsSync(soapNotesFolder)) {
      throw new Error(`SOAP notes folder not found: ${soapNotesFolder}`);
    }
    
    if (!fs.existsSync(veteransSoapFolder)) {
      throw new Error(`Veterans SOAP folder not found: ${veteransSoapFolder}`);
    }
    
    // Get all PDF files from soap notes folder
    const files = fs.readdirSync(soapNotesFolder);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    
    console.log(`Found ${pdfFiles.length} PDF files to organize`);
    
    // Get all patient folders from veterans soap folder
    const veteransFolders = fs.readdirSync(veteransSoapFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    console.log(`Found ${veteransFolders.length} patient folders in veterans soap`);
    
    let processed = 0;
    let notFound = 0;
    let errors = 0;
    
    // Process each PDF file
    for (const pdfFile of pdfFiles) {
      try {
        console.log(`\n--- Processing: ${pdfFile} ---`);
        
        // Extract patient name from filename
        // Formats: "FirstName_LastName_MM_DD_YYYY.pdf" or "FirstName_LastName_MM_DD_YYYY__HH_MM_AM.pdf"
        const nameWithoutExt = pdfFile.replace('.pdf', '');
        let patientName = '';
        
        // Split by underscores to analyze parts
        const parts = nameWithoutExt.split('_');
        
        // Look for date pattern to find where name ends and date begins
        let dateIndex = -1;
        for (let i = 0; i < parts.length - 2; i++) {
          // Check if this and next two parts look like MM_DD_YYYY
          if (parts[i].match(/^\d{2}$/) && parts[i+1].match(/^\d{2}$/) && 
              (parts[i+2].match(/^\d{4}$/) || parts[i+2].match(/^\d{2}$/))) {
            dateIndex = i;
            break;
          }
        }
        
        if (dateIndex > 0) {
          // Take everything before the date as the patient name
          patientName = parts.slice(0, dateIndex).join(' ');
        } else {
          // Fallback: try common patterns
          
          // Pattern 1: Time format at end "...HH_MM_AM/PM"
          if (parts.length >= 3 && (parts[parts.length-1] === 'AM' || parts[parts.length-1] === 'PM')) {
            // Remove time parts (HH_MM_AM/PM) and any empty parts before date
            const timeParts = 3; // HH_MM_AM
            let nameEndIndex = parts.length - timeParts;
            
            // Look backwards for date pattern (MM_DD_YYYY or similar)
            for (let i = nameEndIndex - 1; i >= 2; i--) {
              if (parts[i].match(/^\d{2,4}$/) && parts[i-1].match(/^\d{2}$/) && parts[i-2].match(/^\d{2}$/)) {
                nameEndIndex = i - 2;
                break;
              }
            }
            
            patientName = parts.slice(0, nameEndIndex).join(' ');
          }
          // Pattern 2: Simple date at end (MM_DD_YY or MM_DD_YYYY)  
          else if (parts.length >= 3 && parts[parts.length-1].match(/^\d{2,4}$/) && 
                   parts[parts.length-2].match(/^\d{2}$/) && parts[parts.length-3].match(/^\d{2}$/)) {
            patientName = parts.slice(0, -3).join(' ');
          }
          // Pattern 3: No clear date pattern, assume first 2 parts are name
          else if (parts.length >= 2) {
            patientName = parts.slice(0, 2).join(' ');
          }
          // Fallback: use first part only
          else {
            patientName = parts[0] || nameWithoutExt;
          }
        }
        
        console.log(`Patient name extracted: "${patientName}"`);
        
        // Find matching patient folders (exact first + last name match)
        const matchingFolders = veteransFolders.filter(folder => {
          const folderLower = folder.toLowerCase().trim();
          const patientLower = patientName.toLowerCase().trim();
          
          // Split names into words
          const folderWords = folderLower.split(/\s+/);
          const patientWords = patientLower.split(/\s+/);
          
          // Skip if either has no words
          if (folderWords.length === 0 || patientWords.length === 0) {
            return false;
          }
          
          // For exact match priority: check if folder name exactly matches patient name
          if (folderLower === patientLower) {
            return true;
          }
          
          // For first + last name matching:
          // Check if both first name and last name from patient appear in folder
          if (patientWords.length >= 2) {
            const firstName = patientWords[0];
            const lastName = patientWords[patientWords.length - 1]; // Take last word as surname
            
            // Both first name AND last name must be present in folder
            const hasFirstName = folderWords.includes(firstName);
            const hasLastName = folderWords.includes(lastName);
            
            return hasFirstName && hasLastName;
          }
          
          // For single name patients, require exact match to avoid confusion
          if (patientWords.length === 1) {
            return folderWords.includes(patientWords[0]) && folderWords.length === 1;
          }
          
          return false;
        });
        
        if (matchingFolders.length === 0) {
          console.log(`📁 No folder found for: ${patientName} - creating new folder`);
          
          // Create new patient folder
          const newFolderPath = path.join(veteransSoapFolder, patientName);
          
          try {
            fs.mkdirSync(newFolderPath, { recursive: true });
            console.log(`✅ Created folder: ${patientName}`);
            
            // Use the newly created folder
            const targetFolder = newFolderPath;
            
            // Move the file
            const sourcePath = path.join(soapNotesFolder, pdfFile);
            const targetPath = path.join(targetFolder, pdfFile);
            
            console.log(`Moving to newly created folder: ${patientName}`);
            
            // Check if file already exists in target
            if (fs.existsSync(targetPath)) {
              console.log(`⚠️ File already exists in target folder, skipping: ${pdfFile}`);
              continue;
            }
            
            fs.renameSync(sourcePath, targetPath);
            console.log(`✅ Successfully moved: ${pdfFile}`);
            processed++;
            
          } catch (error) {
            console.error(`❌ Error creating folder or moving file for ${patientName}: ${error.message}`);
            errors++;
          }
          
          continue;
        }
        
        console.log(`Found ${matchingFolders.length} matching folders: ${matchingFolders.join(', ')}`);
        
        // Select the best matching folder
        let selectedFolder;
        
        if (matchingFolders.length === 1) {
          selectedFolder = matchingFolders[0];
        } else {
          // Multiple matches - prioritize exact match, then shortest folder name (more specific)
          const patientLower = patientName.toLowerCase().trim();
          
          // Check for exact match first
          const exactMatch = matchingFolders.find(folder => folder.toLowerCase().trim() === patientLower);
          if (exactMatch) {
            selectedFolder = exactMatch;
            console.log(`✅ Using exact match: ${exactMatch}`);
          } else {
            // Use shortest folder name (typically more specific)
            selectedFolder = matchingFolders.reduce((shortest, current) => 
              current.length < shortest.length ? current : shortest
            );
            console.log(`⚠️ Multiple matches - using shortest: ${selectedFolder}`);
          }
        }
        
        const targetFolder = path.join(veteransSoapFolder, selectedFolder);
        console.log(`Target folder: ${selectedFolder}`);
        
        // Move the file
        const sourcePath = path.join(soapNotesFolder, pdfFile);
        const targetPath = path.join(targetFolder, pdfFile);
        
        console.log(`Moving to: ${targetFolder}`);
        
        // Check if file already exists in target
        if (fs.existsSync(targetPath)) {
          console.log(`⚠️ File already exists in target folder, skipping: ${pdfFile}`);
          continue;
        }
        
        fs.renameSync(sourcePath, targetPath);
        console.log(`✅ Successfully moved: ${pdfFile}`);
        processed++;
        
      } catch (error) {
        console.error(`❌ Error processing ${pdfFile}: ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n=== ORGANIZATION COMPLETE ===');
    console.log(`✅ Successfully processed: ${processed} files`);
    console.log(`❌ No matching folders: ${notFound} files`);
    console.log(`⚠️ Errors: ${errors} files`);
    
  } catch (error) {
    console.error('Error organizing SOAP notes:', error);
  }
}

organizeDropboxSOAPs();