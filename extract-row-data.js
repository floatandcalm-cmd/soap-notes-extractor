const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

const TOKEN_PATH = 'token.json';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];

class RowDataExtractor {
  constructor() {
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    this.sheets = google.sheets({ version: 'v4', auth: this.oAuth2Client });
  }

  async authorize() {
    try {
      const token = fs.readFileSync(TOKEN_PATH);
      this.oAuth2Client.setCredentials(JSON.parse(token));
      console.log('✅ Authorization successful');
    } catch (error) {
      console.error('❌ Authorization failed. Please run the main script first to authorize.');
      throw error;
    }
  }

  async getRowData(rowNumber) {
    try {
      // Get the specific row (rowNumber is 1-indexed, so 1312 means row 1312)
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${process.env.SHEET_NAME}!A${rowNumber}:Q${rowNumber}`,
      });
      
      const rowData = response.data.values ? response.data.values[0] : [];
      console.log(`✅ Successfully retrieved row ${rowNumber}`);
      return rowData;
    } catch (error) {
      console.error('❌ Error reading sheet data:', error);
      throw error;
    }
  }

  parseClientName(fullName) {
    if (!fullName || typeof fullName !== 'string') {
      return { firstName: '', lastName: '', fullName: '' };
    }

    const name = fullName.trim();
    const nameParts = name.split(/\s+/);
    
    if (nameParts.length === 1) {
      return {
        firstName: nameParts[0],
        lastName: '',
        fullName: name
      };
    } else if (nameParts.length === 2) {
      return {
        firstName: nameParts[0],
        lastName: nameParts[1],
        fullName: name
      };
    } else {
      // For names with more than 2 parts, treat first as firstName and rest as lastName
      return {
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' '),
        fullName: name
      };
    }
  }

  parseAddressAndZip(address, zipField) {
    let city = '';
    let state = '';
    let zipCode = '';
    
    // Check if ZIP field contains city information
    if (zipField && typeof zipField === 'string') {
      const zipFieldTrimmed = zipField.trim();
      
      // Pattern: "City, State ZIP" or "City State ZIP" or just "ZIP"
      const zipWithCityMatch = zipFieldTrimmed.match(/^(.+?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      const justZipMatch = zipFieldTrimmed.match(/^(\d{5}(?:-\d{4})?)$/);
      
      if (zipWithCityMatch) {
        city = zipWithCityMatch[1].trim();
        state = zipWithCityMatch[2];
        zipCode = zipWithCityMatch[3];
      } else if (justZipMatch) {
        zipCode = justZipMatch[1];
      } else {
        // If it doesn't match expected patterns, treat as raw zip
        zipCode = zipFieldTrimmed;
      }
    }
    
    return {
      address: address || '',
      city,
      state,
      zipCode
    };
  }

  formatDateOfBirth(dobString) {
    if (!dobString) return '';
    
    // Handle various date formats
    const dateStr = dobString.toString().trim();
    
    // Try to parse different date formats
    let date;
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        // Assume MM/DD/YYYY format
        date = new Date(parts[2], parts[0] - 1, parts[1]);
      }
    } else if (dateStr.includes('-')) {
      date = new Date(dateStr);
    } else {
      // Try direct parsing
      date = new Date(dateStr);
    }
    
    if (date && !isNaN(date.getTime())) {
      // Return in MM/DD/YYYY format
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    }
    
    return dateStr; // Return original if parsing fails
  }

  async extractRowData(rowNumber = 1312) {
    try {
      console.log(`🔍 Extracting data from row ${rowNumber}...`);
      
      await this.authorize();
      const rowData = await this.getRowData(rowNumber);
      
      if (!rowData || rowData.length === 0) {
        throw new Error(`No data found in row ${rowNumber}`);
      }
      
      // Extract relevant columns (0-indexed)
      const clientNameRaw = rowData[5] || '';  // Column F
      const dobRaw = rowData[6] || '';         // Column G
      const ssnRaw = rowData[7] || '';         // Column H
      const addressRaw = rowData[9] || '';     // Column J
      const zipRaw = rowData[10] || '';        // Column K
      
      // Parse client name
      const clientName = this.parseClientName(clientNameRaw);
      
      // Parse address and ZIP
      const addressInfo = this.parseAddressAndZip(addressRaw, zipRaw);
      
      // Format date of birth
      const dateOfBirth = this.formatDateOfBirth(dobRaw);
      
      // Create the extracted data object
      const extractedData = {
        rowNumber,
        clientName: {
          full: clientName.fullName,
          first: clientName.firstName,
          last: clientName.lastName
        },
        dateOfBirth,
        socialSecurity: ssnRaw,
        address: {
          street: addressInfo.address,
          city: addressInfo.city,
          state: addressInfo.state,
          zipCode: addressInfo.zipCode
        },
        rawData: {
          columnF_clientName: clientNameRaw,
          columnG_dateOfBirth: dobRaw,
          columnH_socialSecurity: ssnRaw,
          columnJ_address: addressRaw,
          columnK_zip: zipRaw
        }
      };
      
      console.log('\n📋 EXTRACTED DATA FOR AVAILITY FORM:');
      console.log('=====================================');
      console.log(`Row Number: ${extractedData.rowNumber}`);
      console.log(`\n👤 CLIENT INFORMATION:`);
      console.log(`  Full Name: ${extractedData.clientName.full}`);
      console.log(`  First Name: ${extractedData.clientName.first}`);
      console.log(`  Last Name: ${extractedData.clientName.last}`);
      console.log(`  Date of Birth: ${extractedData.dateOfBirth}`);
      console.log(`  Social Security: ${extractedData.socialSecurity}`);
      
      console.log(`\n🏠 ADDRESS INFORMATION:`);
      console.log(`  Street Address: ${extractedData.address.street}`);
      console.log(`  City: ${extractedData.address.city}`);
      console.log(`  State: ${extractedData.address.state}`);
      console.log(`  ZIP Code: ${extractedData.address.zipCode}`);
      
      console.log(`\n📊 RAW DATA FROM SPREADSHEET:`);
      console.log(`  Column F (Client Name): "${extractedData.rawData.columnF_clientName}"`);
      console.log(`  Column G (Date of Birth): "${extractedData.rawData.columnG_dateOfBirth}"`);
      console.log(`  Column H (Social Security): "${extractedData.rawData.columnH_socialSecurity}"`);
      console.log(`  Column J (Address): "${extractedData.rawData.columnJ_address}"`);
      console.log(`  Column K (ZIP): "${extractedData.rawData.columnK_zip}"`);
      
      // Save to JSON file for easy access
      const outputFile = `row_${rowNumber}_data.json`;
      fs.writeFileSync(outputFile, JSON.stringify(extractedData, null, 2));
      console.log(`\n💾 Data saved to: ${outputFile}`);
      
      return extractedData;
      
    } catch (error) {
      console.error('❌ Error extracting row data:', error);
      throw error;
    }
  }
}

// Export the class for use in other modules
module.exports = { RowDataExtractor };

// Only run if this file is executed directly
if (require.main === module) {
  const extractor = new RowDataExtractor();
  
  // Get row number from command line argument or default to 1312
  const rowNumber = process.argv[2] ? parseInt(process.argv[2]) : 1312;
  
  extractor.extractRowData(rowNumber).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}