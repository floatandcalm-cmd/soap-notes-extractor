// Create Excel spreadsheet with list of all SOAP notes from Dropbox folder
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

async function createExcelFromDropbox() {
  try {
    console.log('=== CREATING EXCEL LIST FROM DROPBOX SOAP NOTES ===');
    
    // Get all PDF files from the Dropbox soap notes directory
    const soapNotesDir = '/Users/liligutierrez/Dropbox/Floatandcalm Team Folder/Soap Notes';
    
    if (!fs.existsSync(soapNotesDir)) {
      throw new Error('Dropbox Soap Notes directory not found');
    }
    
    const files = fs.readdirSync(soapNotesDir);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    
    console.log(`Found ${pdfFiles.length} PDF files in Dropbox`);
    
    // Create data array for Excel
    const data = [];
    
    // Add header row
    data.push(['Client Name', 'Date', 'Time', 'Filename', 'File Path']);
    
    // Process each PDF file
    pdfFiles.forEach((filename, index) => {
      // Parse filename to extract client info
      // Format: "ClientName_MM_DD_YYYY.pdf"
      const nameWithoutExt = filename.replace('.pdf', '');
      
      let clientName = '';
      let date = '';
      let time = '';
      
      // Try to parse standard format first
      const standardMatch = nameWithoutExt.match(/^(.+?)_(\d{1,2})_(\d{1,2})_(\d{4})$/);
      
      if (standardMatch) {
        clientName = standardMatch[1].replace(/_/g, ' ');
        const month = standardMatch[2];
        const day = standardMatch[3];
        const year = standardMatch[4];
        
        date = `${month}/${day}/${year}`;
        time = 'N/A'; // Time not available in this format
      } else {
        // Handle special cases or non-standard formats
        if (nameWithoutExt.includes('_')) {
          const parts = nameWithoutExt.split('_');
          clientName = parts[0].replace(/_/g, ' ');
          
          // Try to extract date from remaining parts
          if (parts.length >= 4) {
            const month = parts[parts.length - 3];
            const day = parts[parts.length - 2];
            const year = parts[parts.length - 1];
            date = `${month}/${day}/${year}`;
          } else {
            date = 'Various';
          }
          time = 'N/A';
        } else {
          clientName = nameWithoutExt.replace(/_/g, ' ');
          date = 'N/A';
          time = 'N/A';
        }
      }
      
      // Add row to data
      data.push([
        clientName,
        date,
        time,
        filename,
        path.join(soapNotesDir, filename)
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
      { width: 10 },  // Time
      { width: 40 },  // Filename
      { width: 80 }   // File Path (wider for Dropbox paths)
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Dropbox SOAP Notes');
    
    // Write Excel file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const excelPath = path.join(__dirname, `Dropbox_SOAP_Notes_List_${timestamp}.xlsx`);
    XLSX.writeFile(workbook, excelPath);
    
    console.log(`\n=== EXCEL FILE CREATED ===`);
    console.log(`📊 Excel file saved: ${excelPath}`);
    console.log(`📋 Total SOAP notes: ${pdfFiles.length}`);
    console.log(`📁 Columns: Client Name, Date, Time, Filename, File Path`);
    console.log(`🔤 Sorted alphabetically by client name`);
    console.log(`📂 Source: Dropbox Soap Notes folder`);
    
  } catch (error) {
    console.error('Error creating Excel list:', error);
  }
}

createExcelFromDropbox();