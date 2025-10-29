const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

class AvailityAutomation {
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
        range: `${process.env.SHEET_NAME}!A${rowNumber}:Q${rowNumber}`,
      });

      const row = response.data.values ? response.data.values[0] : [];
      
      if (!row || row.length === 0) {
        throw new Error(`No data found for row ${rowNumber}`);
      }

      const fullName = row[5] || ''; // Column F
      const [firstName, ...lastNameParts] = fullName.split(' ');
      const lastName = lastNameParts.join(' ');

      // Format date of birth from M/D/YYYY to MM/DD/YYYY
      const dobRaw = row[6] || '';
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

      // Parse ZIP and city
      const zipRaw = row[10] || '';
      let city = '';
      let zipCode = zipRaw;
      
      // Check if ZIP has city prefix (e.g., "Socorro 79927")
      const zipMatch = zipRaw.match(/(\d{5})$/);
      if (zipMatch) {
        zipCode = zipMatch[1];
        const cityMatch = zipRaw.replace(zipCode, '').trim();
        if (cityMatch) {
          city = cityMatch;
        }
      }

      // If no city found, try to derive from ZIP (El Paso area codes)
      if (!city) {
        const elPasoZips = ['79901', '79902', '79903', '79904', '79905', '79906', '79907', '79908', '79910', '79911', '79912', '79913', '79914', '79915', '79916', '79917', '79918', '79920', '79922', '79924', '79925', '79926', '79927', '79928', '79929', '79930', '79931', '79932', '79934', '79935', '79936', '79937', '79938'];
        if (elPasoZips.includes(zipCode)) {
          city = 'El Paso';
        }
      }

      return {
        rowNumber,
        firstName: firstName || '',
        lastName: lastName || '',
        fullName: fullName,
        dateOfBirth: formattedDOB,
        address: row[9] || '', // Column J
        city: city,
        state: city === 'El Paso' ? 'TX' : '',
        zipCode: zipCode,
        ssn: row[7] || '', // Column H
        authorization: row[8] || '', // Column I
        serviceDate: row[0] || '', // Column A
        therapist: row[3] || '' // Column D
      };
    } catch (error) {
      console.error('Error getting row data:', error);
      throw error;
    }
  }

  async initBrowser() {
    console.log('🌐 Starting browser...');
    this.browser = await puppeteer.launch({
      headless: false, // Keep browser visible
      defaultViewport: null,
      args: ['--start-maximized']
    });
    
    this.page = await this.browser.newPage();
    console.log('✅ Browser started');
  }

  async waitForUser(message) {
    console.log(`\n⏸️  ${message}`);
    console.log('Press Enter to continue...');
    
    return new Promise((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });
  }

  async fillAvailityForm(rowData) {
    try {
      console.log(`\n📝 Filling form for: ${rowData.fullName}`);
      
      // Check if we're on the right page
      const currentUrl = this.page.url();
      console.log(`Current URL: ${currentUrl}`);
      
      // Wait for form to be loaded
      await this.page.waitForSelector('input', { timeout: 10000 });
      
      // Fill Last Name
      console.log('📝 Filling Last Name...');
      const lastNameSelector = 'input[placeholder=""], input[type="text"]';
      const lastNameFields = await this.page.$$(lastNameSelector);
      
      // Try to find the last name field (usually first text input after the search field)
      let lastNameField = null;
      for (const field of lastNameFields) {
        const fieldId = await field.evaluate(el => el.id || '');
        const fieldName = await field.evaluate(el => el.name || '');
        const placeholder = await field.evaluate(el => el.placeholder || '');
        
        if (fieldId.toLowerCase().includes('last') || 
            fieldName.toLowerCase().includes('last') ||
            placeholder.toLowerCase().includes('last')) {
          lastNameField = field;
          break;
        }
      }
      
      if (!lastNameField && lastNameFields.length > 1) {
        // Fallback: use second text field (after search field)
        lastNameField = lastNameFields[1];
      }
      
      if (lastNameField) {
        await lastNameField.click();
        await lastNameField.fill(rowData.lastName);
        console.log(`✅ Last Name: ${rowData.lastName}`);
      }
      
      // Fill First Name
      console.log('📝 Filling First Name...');
      const firstNameFields = await this.page.$$(lastNameSelector);
      let firstNameField = null;
      
      for (const field of firstNameFields) {
        const fieldId = await field.evaluate(el => el.id || '');
        const fieldName = await field.evaluate(el => el.name || '');
        const placeholder = await field.evaluate(el => el.placeholder || '');
        
        if (fieldId.toLowerCase().includes('first') || 
            fieldName.toLowerCase().includes('first') ||
            placeholder.toLowerCase().includes('first')) {
          firstNameField = field;
          break;
        }
      }
      
      if (!firstNameField && firstNameFields.length > 2) {
        // Fallback: use third text field
        firstNameField = firstNameFields[2];
      }
      
      if (firstNameField) {
        await firstNameField.click();
        await firstNameField.fill(rowData.firstName);
        console.log(`✅ First Name: ${rowData.firstName}`);
      }
      
      // Fill Date of Birth
      if (rowData.dateOfBirth) {
        console.log('📝 Filling Date of Birth...');
        const dobField = await this.page.$('input[placeholder="mm/dd/yyyy"]');
        if (dobField) {
          await dobField.click();
          await dobField.fill(rowData.dateOfBirth);
          console.log(`✅ Date of Birth: ${rowData.dateOfBirth}`);
        }
      }
      
      // Fill Address
      if (rowData.address) {
        console.log('📝 Filling Address...');
        const addressFields = await this.page.$$('input[type="text"]');
        
        // Look for address field
        for (const field of addressFields) {
          const fieldId = await field.evaluate(el => el.id || '');
          const fieldName = await field.evaluate(el => el.name || '');
          const placeholder = await field.evaluate(el => el.placeholder || '');
          
          if (fieldId.toLowerCase().includes('address') || 
              fieldName.toLowerCase().includes('address') ||
              placeholder.toLowerCase().includes('address')) {
            await field.click();
            await field.fill(rowData.address);
            console.log(`✅ Address: ${rowData.address}`);
            break;
          }
        }
      }
      
      // Fill City
      if (rowData.city) {
        console.log('📝 Filling City...');
        const cityFields = await this.page.$$('input[type="text"]');
        
        for (const field of cityFields) {
          const fieldId = await field.evaluate(el => el.id || '');
          const fieldName = await field.evaluate(el => el.name || '');
          const placeholder = await field.evaluate(el => el.placeholder || '');
          
          if (fieldId.toLowerCase().includes('city') || 
              fieldName.toLowerCase().includes('city') ||
              placeholder.toLowerCase().includes('city')) {
            await field.click();
            await field.fill(rowData.city);
            console.log(`✅ City: ${rowData.city}`);
            break;
          }
        }
      }
      
      // Fill ZIP Code
      if (rowData.zipCode) {
        console.log('📝 Filling ZIP Code...');
        const zipFields = await this.page.$$('input[type="text"]');
        
        for (const field of zipFields) {
          const fieldId = await field.evaluate(el => el.id || '');
          const fieldName = await field.evaluate(el => el.name || '');
          const placeholder = await field.evaluate(el => el.placeholder || '');
          
          if (fieldId.toLowerCase().includes('zip') || 
              fieldName.toLowerCase().includes('zip') ||
              placeholder.toLowerCase().includes('zip') ||
              fieldId.toLowerCase().includes('postal')) {
            await field.click();
            await field.fill(rowData.zipCode);
            console.log(`✅ ZIP Code: ${rowData.zipCode}`);
            break;
          }
        }
      }
      
      // Handle State dropdown
      if (rowData.state) {
        console.log('📝 Setting State...');
        try {
          // Look for state dropdown
          const stateDropdown = await this.page.$('select');
          if (stateDropdown) {
            await stateDropdown.selectOption(rowData.state);
            console.log(`✅ State: ${rowData.state}`);
          } else {
            // Look for state input field
            const stateFields = await this.page.$$('input[type="text"]');
            for (const field of stateFields) {
              const fieldId = await field.evaluate(el => el.id || '');
              const fieldName = await field.evaluate(el => el.name || '');
              
              if (fieldId.toLowerCase().includes('state') || 
                  fieldName.toLowerCase().includes('state')) {
                await field.click();
                await field.fill(rowData.state);
                console.log(`✅ State: ${rowData.state}`);
                break;
              }
            }
          }
        } catch (error) {
          console.log(`⚠️  Could not fill state automatically: ${error.message}`);
        }
      }
      
      // Wait for user to handle Gender and review
      await this.waitForUser(`
📋 AUTO-FILLED DATA:
   - Name: ${rowData.firstName} ${rowData.lastName}
   - DOB: ${rowData.dateOfBirth}
   - Address: ${rowData.address}
   - City: ${rowData.city}
   - State: ${rowData.state}
   - ZIP: ${rowData.zipCode}

❗ MANUAL ACTIONS NEEDED:
   1. Select Gender dropdown
   2. Review all fields for accuracy
   3. Continue with form submission when ready
`);
      
    } catch (error) {
      console.error('Error filling form:', error);
      await this.waitForUser('❌ Error occurred. Please review and fix manually.');
    }
  }

  async processRow(rowNumber) {
    try {
      console.log(`\n🔄 Processing Row ${rowNumber}`);
      
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
        await this.waitForUser('🌐 Browser started. Please navigate to the Availity form and position it where you want to fill data.');
      }
      
      // Fill the form
      await this.fillAvailityForm(rowData);
      
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
  const automation = new AvailityAutomation();
  
  try {
    // Get row number from command line argument
    const rowNumber = process.argv[2] || '1312';
    
    console.log('🚀 Starting Availity Automation');
    console.log(`📋 Target Row: ${rowNumber}`);
    
    // Authorize Google Sheets
    await automation.authorize();
    
    // Process the specified row
    await automation.processRow(parseInt(rowNumber));
    
    console.log('\n✅ Automation complete!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    // Keep browser open for manual review
    console.log('\n⏸️  Browser will remain open for your review.');
    console.log('Press Ctrl+C when you want to close the automation.');
    
    // Keep process alive
    process.stdin.resume();
    
    // Handle cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n🔄 Shutting down...');
      await automation.close();
      process.exit(0);
    });
  }
}

if (require.main === module) {
  main();
}

module.exports = { AvailityAutomation };