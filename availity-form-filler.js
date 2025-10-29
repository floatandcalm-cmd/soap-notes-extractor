const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

class AvailityFormFiller {
  constructor() {
    this.browser = null;
    this.page = null;
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.sheets = google.sheets({ version: 'v4', auth: this.oAuth2Client });
  }

  async authorize() {
    try {
      const token = fs.readFileSync('token.json');
      this.oAuth2Client.setCredentials(JSON.parse(token));
      console.log('✅ Google Sheets authorized');
    } catch (error) {
      throw new Error('Google Sheets not authorized - run SOAP extractor first');
    }
  }

  async getRowData(rowNumber) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${process.env.SHEET_NAME}!A${rowNumber}:K${rowNumber}`,
      });

      const row = response.data.values ? response.data.values[0] : [];
      
      if (!row || row.length === 0) {
        throw new Error(`No data found for row ${rowNumber}`);
      }

      // Parse the data according to your mapping
      const fullName = row[5] || ''; // Column F
      const [firstName, ...lastNameParts] = fullName.split(' ');
      const lastName = lastNameParts.join(' ');

      // Format date of birth from M/D/YYYY to MM/DD/YYYY
      const dobRaw = row[6] || ''; // Column G
      let formattedDOB = '';
      if (dobRaw) {
        const dobParts = dobRaw.split('/');
        if (dobParts.length === 3) {
          const month = dobParts[0].padStart(2, '0');
          const day = dobParts[1].padStart(2, '0');
          const year = dobParts[2];
          formattedDOB = `${month}/${day}/${year}`;
        }
      }

      // Parse ZIP code and clean address
      const zipRaw = row[10] || ''; // Column K
      let zipCode = zipRaw;
      
      // Extract ZIP if it has extra text (e.g., "Socorro 79927" -> "79927")
      const zipMatch = zipRaw.match(/(\\d{5})$/);
      if (zipMatch) {
        zipCode = zipMatch[1];
      }

      return {
        rowNumber,
        firstName: firstName || '',
        lastName: lastName || '',
        fullName: fullName,
        dateOfBirth: formattedDOB,
        address: row[9] || '', // Column J
        city: 'El Paso', // Always El Paso as specified
        state: 'TX',
        zipCode: zipCode,
        ssn: row[7] || '', // Column H - for subscriber/insured and patient control
        priorAuthNumber: row[8] || '', // Column I
        patientControlNumber: row[7] || '' // Same as SSN as specified
      };
    } catch (error) {
      console.error('Error getting row data:', error);
      throw error;
    }
  }

  async initBrowser() {
    console.log('🌐 Starting browser...');
    this.browser = await puppeteer.launch({
      headless: false, // Keep browser visible for dropdown selection
      defaultViewport: null,
      args: ['--start-maximized']
    });
    
    this.page = await this.browser.newPage();
    console.log('✅ Browser ready - navigate to Availity form manually');
  }

  async waitForUser(message) {
    console.log(`\\n⏸️  ${message}`);
    console.log('Press Enter to continue...');
    
    return new Promise((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });
  }

  async fillForm(rowData) {
    try {
      console.log(`\\n📝 Filling Availity form with data from row ${rowData.rowNumber}`);
      console.log(`Patient: ${rowData.fullName}`);
      
      // Wait for user to be ready
      await this.waitForUser('Make sure you are on the Availity form page and ready to fill');

      // Fill Patient Control Number / Claim Number (SSN)
      console.log('📝 Filling Patient Control Number...');
      try {
        const patientControlField = await this.page.$('input[type="text"]:first-of-type, input:not([type])');
        if (patientControlField) {
          await patientControlField.click();
          await patientControlField.fill(rowData.patientControlNumber);
          console.log(`✅ Patient Control Number: ${rowData.patientControlNumber}`);
        }
      } catch (error) {
        console.log('⚠️  Could not find Patient Control Number field');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill Subscriber/Insured ID (SSN)
      console.log('📝 Filling Subscriber/Insured ID...');
      try {
        const subscriberFields = await this.page.$$('input[type="text"]');
        // Usually the subscriber field is in the subscriber section
        for (let i = 0; i < subscriberFields.length; i++) {
          const field = subscriberFields[i];
          const fieldValue = await field.evaluate(el => el.value);
          if (!fieldValue) { // Fill empty field
            await field.click();
            await field.fill(rowData.ssn);
            console.log(`✅ Subscriber/Insured ID: ${rowData.ssn}`);
            break;
          }
        }
      } catch (error) {
        console.log('⚠️  Could not find Subscriber/Insured ID field');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill Last Name
      console.log('📝 Filling Last Name...');
      try {
        const nameFields = await this.page.$$('input[type="text"]');
        for (const field of nameFields) {
          const placeholder = await field.evaluate(el => el.placeholder || '');
          const label = await field.evaluate(el => {
            const labels = document.querySelectorAll('label');
            for (const label of labels) {
              if (label.getAttribute('for') === el.id || label.textContent.toLowerCase().includes('last name')) {
                return label.textContent;
              }
            }
            return '';
          });
          
          if (placeholder.toLowerCase().includes('last') || label.toLowerCase().includes('last')) {
            await field.click();
            await field.fill(rowData.lastName);
            console.log(`✅ Last Name: ${rowData.lastName}`);
            break;
          }
        }
      } catch (error) {
        console.log('⚠️  Could not find Last Name field');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill First Name
      console.log('📝 Filling First Name...');
      try {
        const nameFields = await this.page.$$('input[type="text"]');
        for (const field of nameFields) {
          const placeholder = await field.evaluate(el => el.placeholder || '');
          const label = await field.evaluate(el => {
            const labels = document.querySelectorAll('label');
            for (const label of labels) {
              if (label.getAttribute('for') === el.id || label.textContent.toLowerCase().includes('first name')) {
                return label.textContent;
              }
            }
            return '';
          });
          
          if (placeholder.toLowerCase().includes('first') || label.toLowerCase().includes('first')) {
            await field.click();
            await field.fill(rowData.firstName);
            console.log(`✅ First Name: ${rowData.firstName}`);
            break;
          }
        }
      } catch (error) {
        console.log('⚠️  Could not find First Name field');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill Date of Birth
      if (rowData.dateOfBirth) {
        console.log('📝 Filling Date of Birth...');
        try {
          const dobField = await this.page.$('input[placeholder*="mm/dd/yyyy"], input[placeholder*="date"]');
          if (dobField) {
            await dobField.click();
            await dobField.fill(rowData.dateOfBirth);
            console.log(`✅ Date of Birth: ${rowData.dateOfBirth}`);
          }
        } catch (error) {
          console.log('⚠️  Could not find Date of Birth field');
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill Address
      if (rowData.address) {
        console.log('📝 Filling Address...');
        try {
          const addressFields = await this.page.$$('input[type="text"]');
          for (const field of addressFields) {
            const placeholder = await field.evaluate(el => el.placeholder || '');
            const label = await field.evaluate(el => {
              const labels = document.querySelectorAll('label');
              for (const label of labels) {
                if (label.getAttribute('for') === el.id || label.textContent.toLowerCase().includes('address')) {
                  return label.textContent;
                }
              }
              return '';
            });
            
            if (placeholder.toLowerCase().includes('address') || label.toLowerCase().includes('address')) {
              await field.click();
              await field.fill(rowData.address);
              console.log(`✅ Address: ${rowData.address}`);
              break;
            }
          }
        } catch (error) {
          console.log('⚠️  Could not find Address field');
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill City
      console.log('📝 Filling City...');
      try {
        const cityFields = await this.page.$$('input[type="text"]');
        for (const field of cityFields) {
          const placeholder = await field.evaluate(el => el.placeholder || '');
          const label = await field.evaluate(el => {
            const labels = document.querySelectorAll('label');
            for (const label of labels) {
              if (label.getAttribute('for') === el.id || label.textContent.toLowerCase().includes('city')) {
                return label.textContent;
              }
            }
            return '';
          });
          
          if (placeholder.toLowerCase().includes('city') || label.toLowerCase().includes('city')) {
            await field.click();
            await field.fill(rowData.city);
            console.log(`✅ City: ${rowData.city}`);
            break;
          }
        }
      } catch (error) {
        console.log('⚠️  Could not find City field');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill ZIP Code
      if (rowData.zipCode) {
        console.log('📝 Filling ZIP Code...');
        try {
          const zipFields = await this.page.$$('input[type="text"]');
          for (const field of zipFields) {
            const placeholder = await field.evaluate(el => el.placeholder || '');
            const label = await field.evaluate(el => {
              const labels = document.querySelectorAll('label');
              for (const label of labels) {
                if (label.getAttribute('for') === el.id || label.textContent.toLowerCase().includes('zip')) {
                  return label.textContent;
                }
              }
              return '';
            });
            
            if (placeholder.toLowerCase().includes('zip') || label.toLowerCase().includes('zip') || 
                placeholder.toLowerCase().includes('postal') || label.toLowerCase().includes('postal')) {
              await field.click();
              await field.fill(rowData.zipCode);
              console.log(`✅ ZIP Code: ${rowData.zipCode}`);
              break;
            }
          }
        } catch (error) {
          console.log('⚠️  Could not find ZIP Code field');
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill Prior Authorization Number
      if (rowData.priorAuthNumber) {
        console.log('📝 Filling Prior Authorization Number...');
        try {
          const authFields = await this.page.$$('input[type="text"]');
          for (const field of authFields) {
            const placeholder = await field.evaluate(el => el.placeholder || '');
            const label = await field.evaluate(el => {
              const labels = document.querySelectorAll('label');
              for (const label of labels) {
                if (label.getAttribute('for') === el.id || 
                    label.textContent.toLowerCase().includes('prior auth') ||
                    label.textContent.toLowerCase().includes('authorization')) {
                  return label.textContent;
                }
              }
              return '';
            });
            
            if (placeholder.toLowerCase().includes('auth') || label.toLowerCase().includes('auth')) {
              await field.click();
              await field.fill(rowData.priorAuthNumber);
              console.log(`✅ Prior Authorization Number: ${rowData.priorAuthNumber}`);
              break;
            }
          }
        } catch (error) {
          console.log('⚠️  Could not find Prior Authorization Number field');
        }
      }

      // Show summary and wait for user to handle dropdowns
      await this.waitForUser(`
📋 AUTO-FILLED DATA SUMMARY:
   - Patient Control Number: ${rowData.patientControlNumber}
   - Subscriber/Insured ID: ${rowData.ssn}
   - Name: ${rowData.firstName} ${rowData.lastName}
   - DOB: ${rowData.dateOfBirth}
   - Address: ${rowData.address}
   - City: ${rowData.city}
   - State: ${rowData.state}
   - ZIP: ${rowData.zipCode}
   - Prior Auth Number: ${rowData.priorAuthNumber}

❗ MANUAL ACTIONS NEEDED:
   - Select dropdown values (Place of Service, Frequency Type, etc.)
   - Select Gender dropdown
   - Review all fields for accuracy
   - Submit when ready
`);

    } catch (error) {
      console.error('Error filling form:', error);
      await this.waitForUser('❌ Error occurred. Please review and complete manually.');
    }
  }

  async processRow(rowNumber) {
    try {
      console.log(`\\n🔄 Processing Row ${rowNumber}`);
      
      // Get data from Google Sheets
      const rowData = await this.getRowData(rowNumber);
      
      if (!rowData.firstName || !rowData.lastName) {
        console.log(`⚠️  Row ${rowNumber}: Missing name data, skipping...`);
        return;
      }
      
      console.log(`📊 Retrieved data for: ${rowData.fullName}`);
      
      // Initialize browser if not already done
      if (!this.browser) {
        await this.initBrowser();
      }
      
      // Fill the form
      await this.fillForm(rowData);
      
    } catch (error) {
      console.error(`❌ Error processing row ${rowNumber}:`, error);
    }
  }

  async close() {
    if (this.browser) {
      console.log('🔄 Closing browser...');
      await this.browser.close();
      console.log('✅ Browser closed');
    }
  }
}

// Main execution
async function main() {
  const filler = new AvailityFormFiller();
  
  try {
    // Get row number from command line argument
    const rowNumber = process.argv[2];
    
    if (!rowNumber) {
      console.log('❌ Please provide a row number: node availity-form-filler.js <row_number>');
      console.log('Example: node availity-form-filler.js 1312');
      return;
    }
    
    console.log('🚀 Starting Availity Form Filler');
    console.log(`📋 Target Row: ${rowNumber}`);
    
    // Authorize Google Sheets
    await filler.authorize();
    
    // Process the specified row
    await filler.processRow(parseInt(rowNumber));
    
    console.log('\\n✅ Form filling complete!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    // Keep browser open for manual completion
    console.log('\\n⏸️  Browser will remain open for your review.');
    console.log('Press Ctrl+C when you want to close the automation.');
    
    // Keep process alive
    process.stdin.resume();
    
    // Handle cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\\n🔄 Shutting down...');
      await filler.close();
      process.exit(0);
    });
  }
}

if (require.main === module) {
  main();
}

module.exports = { AvailityFormFiller };