const { jsPDF } = require('jspdf');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing jsPDF generation...');

try {
  // Create jsPDF document (A4 size)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Set document properties
  doc.setProperties({
    title: 'Test PDF Report',
    author: 'Patent Analysis System',
    subject: 'Test Report',
  });

  // Add content
  doc.setFontSize(20);
  doc.text('PATENT NOVELTY ASSESSMENT REPORT', 20, 30);

  doc.setFontSize(12);
  doc.text('Test PDF generated with jsPDF', 20, 50);
  doc.text('No font loading errors!', 20, 65);

  // Create test directory
  const testDir = path.join(__dirname, 'test-outputs');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filepath = path.join(testDir, 'test-jspdf.pdf');
  const pdfBuffer = doc.output('arraybuffer');
  fs.writeFileSync(filepath, Buffer.from(pdfBuffer));

  console.log('✅ jsPDF generated successfully!');
  console.log(`📄 Test PDF saved to: ${filepath}`);
  console.log('🎉 Font loading errors have been resolved with jsPDF!');

} catch (error) {
  console.error('❌ jsPDF creation failed:', error);
}
