const fs = require('fs');
const file = 'public/app.js';
let content = fs.readFileSync(file, 'utf8');

// Fix 1: Clear rbac-wrap immediately at start of renderUserAccess to prevent flicker
const old = `async function renderUserAccess(){
  try{
    const [caps, users] = await Promise.all([api('GET','/role-capabilities'), api('GET','/users')]);`;

const updated = `async function renderUserAccess(){
  // Clear old static HTML immediately to prevent flicker
  const wrap = document.getElementById('viewUserAccess').querySelector('.rbac-wrap');
  if(wrap) wrap.innerHTML='<div style="padding:32px;text-align:center;color:var(--t3)">Loading…</div>';
  try{
    const [caps, users] = await Promise.all([api('GET','/role-capabilities'), api('GET','/users')]);`;

if (!content.includes(old)) {
  console.error('Target string not found. Checking what exists...');
  const idx = content.indexOf('async function renderUserAccess');
  console.log('Function found at index:', idx);
  console.log('Context:', content.substring(idx, idx+200));
  process.exit(1);
}

content = content.replace(old, updated);

// Fix 2: Also update the wrap reference inside the function since we now declare it at top
// The inner function uses: const wrap = document.getElementById('viewUserAccess').querySelector('.rbac-wrap');
// We need to remove the duplicate declaration inside the try block
content = content.replace(
  `    const wrap = document.getElementById('viewUserAccess').querySelector('.rbac-wrap');
    wrap.innerHTML = \``,
  `    wrap.innerHTML = \``
);

fs.writeFileSync(file, content, 'utf8');
console.log('✅ renderUserAccess flicker fix applied');
