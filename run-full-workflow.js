#!/usr/bin/env node
const { SoapNotesExtractor } = require('./index');
const { DocumentProcessor } = require('./download-and-trash-signed');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Create a modified version that processes all rows (for daily runs)
class DailySoapNotesExtractor extends SoapNotesExtractor {
  async run() {
    try {
      console.log('Starting daily SOAP notes extraction...');
      
      // First authorize
      await this.authorize();
      
      const sheetData = await this.getSheetData();
      
      // Process all rows (skip header row only)
      for (let i = 1; i < sheetData.length; i++) {
        await this.processRow(i, sheetData[i]);
      }
      
      console.log('Daily SOAP notes extraction completed!');
      
      // Generate and save report
      this.generateReport();
      
      // Send email report
      await this.sendEmailReport();
      
    } catch (error) {
      console.error('Error in daily process:', error);
    }
  }
}

// Full workflow runner
async function runFullWorkflow() {
  try {
    console.log('=== STARTING FULL DAILY WORKFLOW ===');
    
    // Step 1: Extract SOAP notes
    console.log('Step 1: Extracting SOAP notes...');
    const extractor = new DailySoapNotesExtractor();
    await extractor.run();
    
    // Step 2: Process signatures (wait 10 minutes after SOAP extraction)
    console.log('Step 2: Processing signatures...');
    // Use the same Node that is running this process
    const nodeBin = process.execPath || 'node';
    await execAsync(`${nodeBin} process-unsigned.js`);
    
    // Step 3: Download, organize, and clean up
    console.log('Step 3: Downloading and organizing...');
    const processor = new DocumentProcessor();
    await processor.authorize();
    await processor.processSignedDocuments();
    
    console.log('=== FULL DAILY WORKFLOW COMPLETED ===');
    
  } catch (error) {
    console.error('Error in full workflow:', error);
  }
}

// Run the workflow
runFullWorkflow();
