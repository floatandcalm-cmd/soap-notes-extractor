const fs = require('fs');
const path = require('path');

class FilePlacementFixer {
  constructor() {
    this.veteransDir = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Veterans soap';
    this.misplacedFiles = [];
    this.moveLog = [];
  }

  getAllPatientFolders() {
    return fs.readdirSync(this.veteransDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => !name.startsWith('.') && !name.includes('.pdf') && !name.includes('.xlsx'));
  }

  extractPatientNameFromFile(filename) {
    const nameWithoutExt = filename.replace('.pdf', '');
    
    // Try standard format: Name_M_D_YYYY
    const standardMatch = nameWithoutExt.match(/^(.+?)_(\d{1,2})_(\d{1,2})_(\d{4})/);
    if (standardMatch) {
      return standardMatch[1].replace(/_/g, ' ');
    }
    
    // Try other common formats
    const parts = nameWithoutExt.split('_');
    if (parts.length >= 2) {
      // Assume first part(s) are the name
      const nameParts = [];
      for (const part of parts) {
        // Stop when we hit a date-like pattern
        if (/^\d{1,2}$/.test(part) || /^\d{4}$/.test(part) || 
            /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(part)) {
          break;
        }
        nameParts.push(part);
      }
      return nameParts.join(' ');
    }
    
    return parts[0];
  }

  findCorrectFolder(patientName, allFolders) {
    const patientLower = patientName.toLowerCase();
    
    // First try exact match
    const exactMatch = allFolders.find(folder => 
      folder.toLowerCase() === patientLower
    );
    if (exactMatch) return exactMatch;
    
    // Then try word boundary matches
    const matchingFolders = allFolders.filter(folder => {
      const folderLower = folder.toLowerCase();
      const words = patientLower.split(' ');
      return words.every(word => {
        if (word.length < 2) return true; // Skip very short words
        const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(folderLower);
      });
    });
    
    if (matchingFolders.length === 1) {
      return matchingFolders[0];
    }
    
    return null;
  }

  scanForMisplacedFiles() {
    const allFolders = this.getAllPatientFolders();
    console.log(`Scanning ${allFolders.length} patient folders...`);
    
    let totalFiles = 0;
    let misplacedCount = 0;
    
    for (const folder of allFolders) {
      const folderPath = path.join(this.veteransDir, folder);
      
      try {
        const files = fs.readdirSync(folderPath)
          .filter(file => file.endsWith('.pdf'));
        
        totalFiles += files.length;
        
        for (const file of files) {
          const extractedName = this.extractPatientNameFromFile(file);
          const correctFolder = this.findCorrectFolder(extractedName, allFolders);
          
          if (correctFolder && correctFolder !== folder) {
            this.misplacedFiles.push({
              file,
              currentFolder: folder,
              correctFolder: correctFolder,
              extractedName
            });
            misplacedCount++;
            console.log(`❌ MISPLACED: ${file}`);
            console.log(`   In: ${folder}`);
            console.log(`   Should be in: ${correctFolder}`);
            console.log(`   Extracted name: "${extractedName}"`);
            console.log('');
          }
        }
      } catch (error) {
        console.error(`Error scanning folder ${folder}:`, error.message);
      }
    }
    
    console.log(`\\n📊 SCAN RESULTS:`);
    console.log(`Total files scanned: ${totalFiles}`);
    console.log(`Misplaced files found: ${misplacedCount}`);
    
    return this.misplacedFiles;
  }

  fixMisplacedFiles(dryRun = true) {
    if (this.misplacedFiles.length === 0) {
      console.log('No misplaced files to fix.');
      return;
    }
    
    console.log(`\\n${dryRun ? '🔍 DRY RUN - No files will be moved:' : '📁 MOVING FILES:'}`);
    
    for (const item of this.misplacedFiles) {
      const sourcePath = path.join(this.veteransDir, item.currentFolder, item.file);
      const destPath = path.join(this.veteransDir, item.correctFolder, item.file);
      
      console.log(`${item.file}: ${item.currentFolder} → ${item.correctFolder}`);
      
      if (!dryRun) {
        try {
          // Check if destination file already exists
          if (fs.existsSync(destPath)) {
            console.log(`   ⚠️  File already exists in destination, skipping`);
            continue;
          }
          
          fs.renameSync(sourcePath, destPath);
          this.moveLog.push({...item, success: true});
          console.log(`   ✅ Moved successfully`);
        } catch (error) {
          console.log(`   ❌ Error: ${error.message}`);
          this.moveLog.push({...item, success: false, error: error.message});
        }
      }
    }
    
    if (!dryRun) {
      console.log(`\\n📋 MOVE SUMMARY:`);
      const successful = this.moveLog.filter(item => item.success).length;
      const failed = this.moveLog.filter(item => !item.success).length;
      console.log(`Successful moves: ${successful}`);
      console.log(`Failed moves: ${failed}`);
    }
  }

  run(dryRun = true) {
    console.log('🔍 Starting scan for misplaced files...');
    this.scanForMisplacedFiles();
    this.fixMisplacedFiles(dryRun);
  }
}

// Command line usage
if (require.main === module) {
  const fixer = new FilePlacementFixer();
  const dryRun = !process.argv.includes('--fix');
  
  if (dryRun) {
    console.log('Running in DRY RUN mode. Use --fix to actually move files.');
  }
  
  fixer.run(dryRun);
}

module.exports = { FilePlacementFixer };