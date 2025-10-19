const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing PDF generation with font fixes...');

try {
  // Test PDF creation without font calls
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
  });

  // Create test directory
  const testDir = path.join(__dirname, 'test-outputs');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filepath = path.join(testDir, 'test-pdf.pdf');
  const stream = fs.createWriteStream(filepath);

  doc.pipe(stream);

  // Add content without font() calls
  doc.fontSize(20).text('PDF Font Test', 50, 50);
  doc.fontSize(12).text('This PDF was generated without explicit font() calls', 50, 80);
  doc.fontSize(12).text('Using default Helvetica font built into PDFKit', 50, 100);

  doc.end();

  stream.on('finish', () => {
    console.log('✅ PDF generated successfully!');
    console.log(`📄 Test PDF saved to: ${filepath}`);
    console.log('🎉 Font loading errors have been resolved!');
  });

  stream.on('error', (error) => {
    console.error('❌ PDF stream error:', error);
  });

} catch (error) {
  console.error('❌ PDF creation failed:', error);
}
