const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'public', 'app.js');
let content = fs.readFileSync(file, 'utf8');

// Find and replace the renderUserAccess function
const startMarker = '// ── USER ACCESS CONTROL ────────────────────────────────────────────────────';
const altMarker = '// ── USER ACCESS CONTROL ──────────────────────────────';
const fnStart = content.includes(startMarker) ? content.indexOf(startMarker) : content.indexOf(altMarker);

// Find by function signature instead
const fnIdx = content.indexOf('async function renderUserAccess(){');
const fnIdx2 = content.indexOf('async function toggleRoleCap(');

if (fnIdx === -1) { console.error('renderUserAccess not found'); process.exit(1); }

// Replace from renderUserAccess up to (but not including) toggleRoleCap
const newFn = `async function renderUserAccess(){
  try{
    const [caps, users] = await Promise.all([api('GET','/role-capabilities'), api('GET','/users')]);
    ALL_USERS = users;
    ROLE_CAPS = {};
    caps.forEach(c => { ROLE_CAPS[c.role] = c; });

    // Only the 6 original capabilities shown in the UI
    const capKeys = ['view_all_projects','create_projects','edit_own_projects','view_own_projects','assign_tasks','add_comments'];
    const capLabels = {
      view_all_projects: 'VIEW ALL PROJECTS',
      create_projects:   'CREATE PROJECTS',
      edit_own_projects: 'EDIT PROJECTS (OWN)',
      view_own_projects: 'VIEW PROJECTS (OWN)',
      assign_tasks:      'ASSIGN TASK TO DOERS',
      add_comments:      'ADD COMMENTS'
    };

    const isAdmin = S.role === 'admin';
    const rows = caps.map(c => {
      const cells = capKeys.map(k =>
        \`<td style="text-align:center"><input type="checkbox" \${c[k] ? 'checked' : ''} \${isAdmin ? '' : 'disabled'} onchange="toggleRoleCap('\${c.role}','\${k}',this.checked)"></td>\`
      ).join('');
      return \`<tr><td style="font-weight:600;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--t2);padding:10px 14px">\${c.role}</td>\${cells}</tr>\`;
    }).join('');

    const headers = capKeys.map(k =>
      \`<th style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;text-align:center;padding:10px 14px">\${capLabels[k]}</th>\`
    ).join('');

    const wrap = document.getElementById('viewUserAccess').querySelector('.rbac-wrap');
    wrap.innerHTML = \`
      <div class="rbac-title">Role Capabilities</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;margin-top:14px">
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;text-align:left;padding:10px 14px">ROLE</th>
            \${headers}
          </tr></thead>
          <tbody>\${rows}</tbody>
        </table></div>
      </div>\`;
  } catch(e) { console.error('renderUserAccess error:', e); }
}
`;

const before = content.substring(0, fnIdx);
const after = content.substring(fnIdx2);
const updated = before + newFn + '\n' + after;

fs.writeFileSync(file, updated, 'utf8');
console.log('✅ renderUserAccess updated successfully');
console.log('Lines now:', updated.split('\n').length);
