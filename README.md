# SOAP Notes Extractor

Extracts SOAP notes from PDF files and updates Google Sheets with the extracted content.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up Google API credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable Google Sheets API and Google Drive API
   - Create credentials (OAuth 2.0 Client ID)
   - Download the credentials JSON file

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` file with your Google API credentials

## Configuration

The application is pre-configured for your spreadsheet:
- **Spreadsheet ID**: `1RYS1fanhYnFsibZ1Ql1D6v8PNk31S9bda8CKwmqUzEA`
- **Worksheet**: `2025`
- **Date Column**: A
- **Client Name Column**: F  
- **SOAP Notes Column**: P
- **Trigger Column**: Q

## How it works

1. Reads client data from Google Sheets
2. For each row with a date and client name (but no existing SOAP note):
   - Searches Google Drive for PDF files containing the client's name
   - Downloads and extracts text from the PDF
   - Finds SOAP notes for the specific date (format: 5/21/25)
   - Updates the Google Sheet with the extracted SOAP note

## Usage

Run the full daily workflow manually:

```bash
/opt/homebrew/bin/node run-full-workflow.js
```

## Scheduling (macOS)

This project is scheduled via a LaunchAgent that runs at 11:00 AM on weekdays:

- Plist: `~/Library/LaunchAgents/com.soapextractor.daily.plist`
- Command: `/opt/homebrew/bin/node /Users/<you>/Documents/soap-notes-extractor/run-full-workflow.js`
- Logs: `scheduler.log` (stdout), `scheduler-error.log` (stderr)

Useful launchctl commands:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soapextractor.daily.plist
launchctl enable gui/$(id -u)/com.soapextractor.daily
launchctl list | grep com.soapextractor.daily
launchctl kickstart -k gui/$(id -u)/com.soapextractor.daily  # run now
```

## Notes

- The application skips rows that already have SOAP notes in column P
- PDF files are searched by client name across your entire Google Drive
- Date format in PDFs should match: M/D/YY (e.g., 5/21/25)
- The LaunchAgent ensures the proper PATH and runs Homebrew’s Node
