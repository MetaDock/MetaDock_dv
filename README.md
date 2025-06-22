# MetaDock

A web-based tool management system for bioinformatics tools.

## Dependencies

- Express.js
- SSH2 (for remote server connections)
- Multer (for file uploads)
- EJS (for templating)
- Other dependencies listed in package.json

1. Clone 
2. Create virtual environment
   ```shell
   python -m venv .venv
   ```
3. Activate virtual environment
   - Windows
   ```shell
   .venv\Scripts\activate
   ```
   - macOS or Linux
   ```shell
   source .venv/bin/activate
   ```
3. Install dependencies
   ```shell
   npm install all
   ```
4. Start
   ```shell
   node server.js
   ```
5. visit [localhost](http://localhost:3010)