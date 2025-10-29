# GitHub Actions Setup Guide

This guide will help you set up GitHub Actions to run your SOAP notes extractor automatically in the cloud.

## ⚠️ Important Limitation

**Dropbox Integration**: The current workflow does NOT upload files to Dropbox because GitHub Actions runs in the cloud and doesn't have access to your local Dropbox folder.

### What WILL run in GitHub Actions:
- ✅ Extract SOAP notes from Google Drive PDFs
- ✅ Update Google Sheets with extracted notes
- ✅ Process unsigned documents and add therapist signatures
- ✅ Download signed PDFs (saved as GitHub artifacts, not Dropbox)

### What WON'T run in GitHub Actions:
- ❌ Moving files to your local Dropbox folder
- ❌ Organizing PDFs into patient folders in Dropbox
- ❌ Creating Excel lists in Dropbox

### Solutions:
1. **Keep Dropbox operations local**: Keep your LaunchAgent running for Dropbox operations only
2. **Use Dropbox API**: Modify the code to use Dropbox API instead of local file system (requires code changes)
3. **Manual downloads**: Download PDFs from GitHub Actions artifacts and move them manually

---

## Setting Up GitHub Secrets

You need to add these secrets to your GitHub repository:

### 1. Go to GitHub Repository Settings
1. Navigate to: https://github.com/floatandcalm-cmd/soap-notes-extractor
2. Click **Settings** tab
3. Click **Secrets and variables** → **Actions**
4. Click **New repository secret** for each secret below

### 2. Add Required Secrets

#### `GOOGLE_SERVICE_ACCOUNT_KEY`
- **What it is**: Your Google service account credentials (JSON format)
- **Where to get it**: Copy the entire contents of your `service-account-key.json` file
- **How to add**:
  ```bash
  # On your Mac, copy the file contents:
  cat ~/Documents/soap-notes-extractor/service-account-key.json | pbcopy
  ```
  Then paste into GitHub as the secret value

#### `SPREADSHEET_ID`
- **Value**: `1RYS1fanhYnFsibZ1Ql1D6v8PNk31S9bda8CKwmqUzEA`
- **What it is**: Your Google Sheets spreadsheet ID

#### `SHEET_NAME`
- **Value**: `2025`
- **What it is**: The worksheet name in your spreadsheet

---

## Schedule Configuration

The workflow runs at **11:00 AM Pacific Time on weekdays** (Monday-Friday).

**Note**: GitHub Actions uses UTC time, so the cron is set to `18:00 UTC` which is `11:00 AM PDT`. If you need to adjust:
- 11 AM PST (winter) = 19:00 UTC: Change cron to `'0 19 * * 1-5'`
- 11 AM PDT (summer) = 18:00 UTC: Already set to `'0 18 * * 1-5'`

---

## Testing the Workflow

You can manually trigger the workflow to test it:

1. Go to: https://github.com/floatandcalm-cmd/soap-notes-extractor/actions
2. Click on **Daily SOAP Notes Extractor** workflow
3. Click **Run workflow** button
4. Click **Run workflow** to confirm

---

## Viewing Results

### Check Workflow Runs
- Go to the **Actions** tab: https://github.com/floatandcalm-cmd/soap-notes-extractor/actions
- You'll see each run with status (success/failure)
- Click on a run to see detailed logs

### Download Extracted PDFs
- Click on a completed workflow run
- Scroll to **Artifacts** section at the bottom
- Download the `extracted-pdfs-XXX` artifact
- The artifact contains all PDFs downloaded during that run
- **Note**: Artifacts are kept for 7 days then automatically deleted

---

## Troubleshooting

### Workflow fails with authentication error
- Check that `GOOGLE_SERVICE_ACCOUNT_KEY` secret is set correctly
- Make sure the service account has access to your Google Drive and Sheets

### No files are extracted
- Check the logs in the Actions tab
- Verify that your Google Drive has files matching the client names
- Make sure the service account has permission to access the files

### Want to disable cloud runs temporarily
- Go to: https://github.com/floatandcalm-cmd/soap-notes-extractor/actions
- Click on **Daily SOAP Notes Extractor**
- Click the **⋮** (three dots) menu
- Click **Disable workflow**

---

## Cost

GitHub Actions is **FREE** for private repositories up to:
- 2,000 minutes per month (your workflow uses ~5-10 minutes per run)
- Roughly 200-400 runs per month available for free
- Running weekdays = ~20 runs/month = well within free tier

---

## Next Steps

Once secrets are added:
1. Test the workflow manually (see "Testing the Workflow" above)
2. Check the logs to ensure it runs successfully
3. Download the artifacts to verify PDFs are extracted
4. Decide how to handle Dropbox uploads (keep local LaunchAgent or modify code)
