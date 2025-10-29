# Google Service Account Setup

To prevent token expiration issues, set up a Google Service Account:

## Steps:

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Select your project** (or create a new one)
3. **Navigate to IAM & Admin > Service Accounts**
4. **Create Service Account**:
   - Name: `soap-extractor-service`
   - Description: `Service account for SOAP notes extractor`
5. **Create and download JSON key**
6. **Enable APIs** (if not already enabled):
   - Google Sheets API
   - Google Drive API
   - Google Docs API
7. **Share your spreadsheet and Drive folder with the service account email**

## Add to .env file:

```env
# Add this to your .env file:
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key_id":"..."}
```

## Alternative: Use existing OAuth2 with auto-refresh

If you prefer to keep using OAuth2, I can modify the code to automatically refresh tokens.