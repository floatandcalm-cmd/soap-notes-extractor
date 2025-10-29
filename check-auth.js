#!/usr/bin/env node
const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

const TOKEN_PATH = 'token.json';

async function checkAuthStatus() {
  console.log('🔍 Checking authentication status...\n');
  
  // Check for service account
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      console.log('✅ Service Account detected');
      console.log(`   Project ID: ${credentials.project_id}`);
      console.log('   Status: Ready to use (no expiration)');
      return;
    } catch (error) {
      console.log('❌ Service Account key is invalid');
      console.log(`   Error: ${error.message}`);
    }
  }
  
  // Check OAuth2 token
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
      const hasRefreshToken = !!token.refresh_token;
      const expiryDate = new Date(token.expiry_date);
      const now = new Date();
      const isExpired = expiryDate < now;
      const hoursUntilExpiry = (expiryDate - now) / (1000 * 60 * 60);
      
      console.log('📋 OAuth2 Token Status:');
      console.log(`   Has refresh token: ${hasRefreshToken ? '✅ Yes' : '❌ No'}`);
      console.log(`   Expires: ${expiryDate.toLocaleString()}`);
      console.log(`   Status: ${isExpired ? '❌ Expired' : '✅ Valid'}`);
      
      if (!isExpired) {
        console.log(`   Time remaining: ${Math.round(hoursUntilExpiry)} hours`);
      }
      
      if (hasRefreshToken) {
        console.log('   🔄 Auto-refresh: Enabled');
        
        // Test token refresh
        const oAuth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        
        oAuth2Client.setCredentials(token);
        
        try {
          await oAuth2Client.getAccessToken();
          console.log('   ✅ Token refresh test: SUCCESS');
        } catch (error) {
          console.log('   ❌ Token refresh test: FAILED');
          console.log(`      Error: ${error.message}`);
        }
      } else {
        console.log('   ⚠️  Auto-refresh: Not available (manual reauth needed when expired)');
      }
      
    } catch (error) {
      console.log('❌ Token file is corrupted');
      console.log(`   Error: ${error.message}`);
    }
  } else {
    console.log('❌ No authentication found');
    console.log('   Run: node index.js (to set up OAuth2)');
    console.log('   Or: Set up Service Account (see setup-service-account.md)');
  }
}

checkAuthStatus().catch(console.error);