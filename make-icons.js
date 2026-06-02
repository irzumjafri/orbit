import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import pngToIco from 'png-to-ico';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define sizes needed
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

app.whenReady().then(async () => {
  console.log('Generating icons from SVG...');
  
  // Ensure output directory exists
  const buildDir = path.join(__dirname, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
  }

  // Create temporary directory for iconset
  const iconsetDir = path.join(__dirname, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir);
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const svgFilePath = path.join(__dirname, 'electron/assets/orbit_icon.svg');
  const svgData = fs.readFileSync(svgFilePath, 'utf8');

  // We load a data URL with a canvas to rasterize the SVG nicely at high resolution
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <body>
      <canvas id="canvas"></canvas>
      <script>
        const { ipcRenderer } = require('electron');
        const svgString = \`${svgData.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = async () => {
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          
          const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
          const results = {};

          for (const size of sizes) {
            canvas.width = size;
            canvas.height = size;
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            
            const dataUrl = canvas.toDataURL('image/png');
            results[size] = dataUrl;
          }

          ipcRenderer.send('render-complete', results);
        };
        img.src = url;
      </script>
    </body>
    </html>
  `;

  ipcMain.on('render-complete', async (event, results) => {
    try {
      console.log('Rasterization completed. Writing PNG files...');

      // 1. Save all files to the icon.iconset folder for macOS
      // macOS iconset naming guidelines:
      // icon_16x16.png
      // icon_16x16@2x.png (32x32)
      // icon_32x32.png
      // icon_32x32@2x.png (64x64)
      // icon_128x128.png
      // icon_128x128@2x.png (256x256)
      // icon_256x256.png
      // icon_256x256@2x.png (512x512)
      // icon_512x512.png
      // icon_512x512@2x.png (1024x1024)
      
      const savePng = (size, filename) => {
        const base64Data = results[size].replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(path.join(iconsetDir, filename), base64Data, 'base64');
      };

      savePng(16, 'icon_16x16.png');
      savePng(32, 'icon_16x16@2x.png');
      savePng(32, 'icon_32x32.png');
      savePng(64, 'icon_32x32@2x.png');
      savePng(128, 'icon_128x128.png');
      savePng(256, 'icon_128x128@2x.png');
      savePng(256, 'icon_256x256.png');
      savePng(512, 'icon_256x256@2x.png');
      savePng(512, 'icon_512x512.png');
      savePng(1024, 'icon_512x512@2x.png');

      console.log('Creating macOS .icns using iconutil...');
      const icnsPath = path.join(buildDir, 'icon.icns');
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
      console.log('✓ Created build/icon.icns');

      // 2. Save Windows .ico
      console.log('Creating Windows .ico...');
      const icoPngs = [
        path.join(iconsetDir, 'icon_16x16.png'),
        path.join(iconsetDir, 'icon_32x32.png'),
        path.join(iconsetDir, 'icon_128x128.png'),
        path.join(iconsetDir, 'icon_256x256.png')
      ];
      
      const icoBuf = await pngToIco(icoPngs);
      fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuf);
      console.log('✓ Created build/icon.ico');

      // Cleanup iconset directory
      console.log('Cleaning up temporary files...');
      fs.rmSync(iconsetDir, { recursive: true, force: true });
      
      console.log('Icon generation successfully finished!');
    } catch (err) {
      console.error('Error during generation:', err);
    } finally {
      app.quit();
    }
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
});
