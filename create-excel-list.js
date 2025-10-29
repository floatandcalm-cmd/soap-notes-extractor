const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Generate Excel spreadsheet of downloaded PDF files
function createExcelList() {
  try {
    console.log('=== CREATING EXCEL LIST OF DOWNLOADED PDF FILES ===');
    
    // Get all PDF files from the downloaded_pdfs directory
    const downloadsDir = path.join(__dirname, 'downloaded_pdfs');
    
    if (!fs.existsSync(downloadsDir)) {
      throw new Error('Downloaded PDFs directory not found');
    }
    
    const files = fs.readdirSync(downloadsDir);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    
    console.log(`Found ${pdfFiles.length} PDF files`);
    
    // Create data array for Excel
    const data = [];
    
    // Add header row
    data.push(['Client Name', 'Date', 'Filename', 'File Size (KB)', 'File Path']);
    
    // Process each PDF file
    pdfFiles.forEach((filename) => {
      const filePath = path.join(downloadsDir, filename);
      const stats = fs.statSync(filePath);
      const fileSizeKB = Math.round(stats.size / 1024);
      
      // Parse filename to extract client info
      // Expected format: "ClientName_MM_DD_YYYY.pdf"
      const nameWithoutExt = filename.replace('.pdf', '');
      
      let clientName = '';
      let date = '';
      
      // Try to parse the format with underscores
      const parts = nameWithoutExt.split('_');
      
      if (parts.length >= 4) {
        // Format: ClientName_MM_DD_YYYY
        const dateParts = parts.slice(-3); // Last 3 parts should be MM_DD_YYYY
        
        if (dateParts.length === 3 && 
            dateParts[0].match(/^\d{1,2}$/) && 
            dateParts[1].match(/^\d{1,2}$/) && 
            dateParts[2].match(/^\d{4}$/)) {
          
          clientName = parts.slice(0, -3).join(' ');
          date = `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}`;
        } else {
          // If date parsing fails, treat whole thing as client name
          clientName = nameWithoutExt.replace(/_/g, ' ');
          date = 'Unknown';
        }
      } else {
        // Less than 4 parts, treat as client name
        clientName = nameWithoutExt.replace(/_/g, ' ');
        date = 'Unknown';
      }
      
      // Add row to data
      data.push([
        clientName,
        date,
        filename,
        fileSizeKB,
        filePath
      ]);
    });
    
    // Sort by client name
    const sortedData = [data[0], ...data.slice(1).sort((a, b) => a[0].localeCompare(b[0]))];
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(sortedData);
    
    // Set column widths
    worksheet['!cols'] = [
      { width: 25 },  // Client Name
      { width: 12 },  // Date
      { width: 40 },  // Filename
      { width: 12 },  // File Size
      { width: 60 }   // File Path
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Downloaded PDFs');
    
    // Write Excel file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const excelPath = path.join(__dirname, `Downloaded_PDFs_${timestamp}.xlsx`);
    XLSX.writeFile(workbook, excelPath);
    
    console.log(`\n=== EXCEL FILE CREATED ===`);
    console.log(`📊 Excel file saved: ${excelPath}`);
    console.log(`📋 Total PDF files: ${pdfFiles.length}`);
    console.log(`📁 Columns: Client Name, Date, Filename, File Size (KB), File Path`);
    console.log(`🔤 Sorted alphabetically by client name`);
    
    return excelPath;
    
  } catch (error) {
    console.error('Error creating Excel list:', error);
    throw error;
  }
}

createExcelList();