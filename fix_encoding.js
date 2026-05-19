const fs = require('fs');

function fixFile(filepath) {
  const buf = fs.readFileSync(filepath);
  let result = '';
  let i = 0;
  let fixes = 0;
  
  while (i < buf.length) {
    const b = buf[i];
    
    // Pure ASCII - keep as is
    if (b <= 0x7F) {
      result += String.fromCharCode(b);
      i++;
      continue;
    }
    
    // Non-ASCII byte found - this is a garbled character
    // Collect all consecutive non-ASCII bytes
    let nonAscii = [];
    let j = i;
    while (j < buf.length && buf[j] > 0x7F) {
      nonAscii.push(buf[j]);
      j++;
    }
    
    // Try to identify the garbled sequence
    const hex = nonAscii.map(b => b.toString(16).padStart(2, '0')).join(' ');
    
    // Common garbled UTF-8 sequences (from Windows-1252 misinterpretation)
    // em-dash: e2 80 94 -> â€" in Win-1252: c3 a2 e2 82 ac e2 80 9c
    // right arrow: e2 86 92 -> â†' in Win-1252: c3 a2 e2 80 a0 e2 80 99
    // ellipsis: e2 80 a6 -> â€¦ in Win-1252
    // checkmark: e2 9c 93
    // middle dot: c2 b7
    
    // Just replace with empty string - these are all decoration chars
    // that have plain ASCII alternatives in context
    fixes++;
    i = j;
  }
  
  if (fixes > 0) {
    fs.writeFileSync(filepath, result, 'utf8');
    console.log(`  ${filepath}: removed ${fixes} non-ASCII sequences`);
  } else {
    console.log(`  ${filepath}: clean, no non-ASCII found`);
  }
}

console.log('Scanning and fixing files...');
fixFile('public/app.js');
fixFile('public/index.html');

// Now do targeted text replacements for known issues
let js = fs.readFileSync('public/app.js', 'utf8');
let html = fs.readFileSync('public/index.html', 'utf8');

// Fix app.js: button text - remove arrow, just say "View Tasks"
js = js.replace(/View Tasks\s*->/g, 'View Tasks');
js = js.replace(/View Tasks\s*$/gm, 'View Tasks');

// Fix app.js: "All Projects" link text - remove any leftover chars before it
js = js.replace(/->\s*All Projects/g, 'All Projects');
js = js.replace(/All Projects/g, 'All Projects');

// Verify no non-ASCII remains
const jsNonAscii = js.match(/[^\x00-\x7F]/g);
const htmlNonAscii = html.match(/[^\x00-\x7F]/g);

if (jsNonAscii) console.log('app.js still has non-ASCII:', [...new Set(jsNonAscii)].map(c => 'U+' + c.codePointAt(0).toString(16)).join(', '));
else console.log('app.js: 100% ASCII clean');

if (htmlNonAscii) console.log('index.html still has non-ASCII:', [...new Set(htmlNonAscii)].map(c => 'U+' + c.codePointAt(0).toString(16)).join(', '));
else console.log('index.html: 100% ASCII clean');

// Also check and fix the close task section link
js = js.replace(/ All Projects/g, ' All Projects');

fs.writeFileSync('public/app.js', js, 'utf8');
fs.writeFileSync('public/index.html', html, 'utf8');

console.log('\nDone! Restart server + Ctrl+Shift+R');
