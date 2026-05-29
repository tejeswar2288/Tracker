// -- CONSTANTS --
const TODAY = new Date(); TODAY.setHours(0,0,0,0);
// Parse "YYYY-MM-DD" as local date (not UTC) to prevent timezone shifts
function parseLocalDate(d) { if(!d) return null; const parts=String(d).split('T')[0].split('-'); return new Date(+parts[0], +parts[1]-1, +parts[2]); }
const fmt = d => { if(!d) return '-'; const dt=parseLocalDate(d); return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };
const fmtTs = ts => { if(!ts) return '-'; const d=new Date(ts); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'})+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); };
const dlCls = dl => { if(!dl) return 'dl-none'; const diff=Math.ceil((parseLocalDate(dl)-TODAY)/86400000); if(diff<0) return 'dl-over'; if(diff<=7) return 'dl-soon'; if(diff<=21) return 'dl-ok'; return 'dl-far'; };
const dlNote = dl => { if(!dl) return ''; const diff=Math.ceil((parseLocalDate(dl)-TODAY)/86400000); if(diff<0) return `${Math.abs(diff)}d overdue`; if(diff===0) return 'Due today'; if(diff<=7) return `${diff}d left`; return ''; };
const COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#84cc16'];
const STAT_LABELS = {pending:'Pending',inprogress:'In Progress',review:'Under Review',deferred:'Deferred',blocked:'Blocked',done:'Done'};
const STAT_CLS = {pending:'ss-pending',inprogress:'ss-inprogress',review:'ss-review',deferred:'ss-deferred',blocked:'ss-blocked',done:'ss-done'};
const STAT_DOT = {pending:'d-pending',inprogress:'d-inprogress',review:'d-review',deferred:'d-deferred',blocked:'d-blocked',done:'d-done'};
const PORDER = {pending:0,inprogress:1,review:2,deferred:3,blocked:4,done:5};
const PRIO_CLS = {high:'prio-high',medium:'prio-med',low:'prio-low'};
const PRIO_VAL = {high:1,medium:2,low:3};

// -- API HELPER --
async function api(method, path, body) {
  const opts = { method, credentials:'include', headers:{'Content-Type':'application/json'} };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function showSaved(msg='Saved!') {
  const i=document.getElementById('saveInd'), t=document.getElementById('saveTxt');
  i.classList.add('saved'); t.textContent=msg;
  clearTimeout(showSaved._t); showSaved._t=setTimeout(()=>{ i.classList.remove('saved'); t.textContent='All changes saved'; },2500);
}

// -- SESSION STATE --
let S = {id:'',name:'',role:'',managedProjects:[]};
let ROLE_CAPS = {};
let ALL_USERS = [];

function hasRoleCap(role, cap) { return !!(ROLE_CAPS[role] && ROLE_CAPS[role][cap]); }

// -- LOGIN --
async function buildLoginDropdown() {
  // Still load all users for other parts of the app (task assignment etc.)
  try {
    ALL_USERS = await api('GET','/auth/people');
  } catch(e) { console.error('Failed to load users:', e); }
}

function onLoginInput() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const dot = document.getElementById('roleDot');
  const txt = document.getElementById('roleText');
  if(email && password) {
    btn.disabled = false;
    dot.style.background = '#15803d';
    txt.style.color = 'var(--green-t)';
    txt.textContent = 'Ready to log in';
  } else {
    btn.disabled = true;
    dot.style.background = 'var(--border-s)';
    txt.style.color = 'var(--t3)';
    txt.textContent = 'Enter your credentials to continue';
  }
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if(!email || !password) return;
  try {
    const user = await api('POST','/auth/login',{email, password});
    S = {id:user.id, name:user.name, role:user.role, managedProjects:user.managedProjects||[]};
    // Load role caps
    const caps = await api('GET','/role-capabilities');
    ROLE_CAPS = {};
    caps.forEach(c => { ROLE_CAPS[c.role] = c; });
    document.getElementById('loginScreen').style.display='none';
    const app=document.getElementById('appShell'); app.style.display='flex'; app.style.flexDirection='column';
    const initials=user.name.split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
    document.getElementById('uAvatar').textContent=initials;
    document.getElementById('uName').textContent=user.name;
    document.getElementById('uRole').textContent={admin:'Admin',manager:'Manager',doer:'Task Doer'}[S.role]||S.role;
    buildTabs();
    switchTab(S.role==='doer'?'doer':'manager');
  } catch(e) { 
    document.getElementById('roleDot').style.background='#b91c1c';
    document.getElementById('roleText').style.color='var(--red-t)';
    document.getElementById('roleText').textContent=e.message || 'Invalid email or password';
  }
}

async function doLogout() {
  try { await api('POST','/auth/logout'); } catch(e) {}
  S={id:'',name:'',role:'',managedProjects:[]};
  selectedProjId=null;
  document.getElementById('appShell').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginEmail').value='';
  document.getElementById('loginPassword').value='';
  document.getElementById('loginBtn').disabled=true;
  document.getElementById('roleDot').style.background='var(--border-s)';
  document.getElementById('roleText').style.color='var(--t3)';
  document.getElementById('roleText').textContent='Enter your credentials to continue';
  buildLoginDropdown();
}

// -- TABS --
let currentTab='doer';
function buildTabs() {
  const tabs=[];
  if(S.role==='admin'){ tabs.push({id:'doer',label:'My Tasks'},{id:'manager',label:'Manage Projects'},{id:'userAccess',label:'User Access Control'}); }
  else if(S.role==='manager'){ tabs.push({id:'doer',label:'My Tasks'},{id:'manager',label:'Manage Projects'}); }
  else { tabs.push({id:'doer',label:'My Tasks'}); }
  document.getElementById('viewTabs').innerHTML=tabs.map(t=>`<button class="vtab" id="vtab-${t.id}" onclick="switchTab('${t.id}')">${t.label}</button>`).join('');
}
function switchTab(tab) {
  if(tab==='userAccess'&&S.role!=='admin') tab='doer';
  currentTab=tab;
  document.querySelectorAll('.vtab').forEach(el=>el.classList.remove('active'));
  const el=document.getElementById('vtab-'+tab); if(el) el.classList.add('active');
  document.getElementById('viewDoer').style.display=tab==='doer'?'block':'none';
  document.getElementById('viewManager').style.display=tab==='manager'?'block':'none';
  document.getElementById('viewUserAccess').style.display=tab==='userAccess'?'block':'none';
  if(tab==='doer') renderDoer();
  if(tab==='manager') renderManager();
  if(tab==='userAccess') renderUserAccess();
}

// -- DOER VIEW --
async function renderDoer() {
  document.getElementById('btnAddProj').disabled=!hasRoleCap(S.role,'create_projects');
  document.getElementById('doerTitle').textContent=`My Tasks - ${S.name}`;
  document.getElementById('doerContent').innerHTML=`<div class="doer-proj-wrap"><div class="doer-empty">Loading...</div></div>`;
  try {
    const tasks = await api('GET','/tasks/my-tasks');
    const total=tasks.length, done=tasks.filter(t=>t.status==='done').length;
    const over=tasks.filter(t=>t.status!=='done'&&t.deadline&&new Date(t.deadline)<TODAY).length;
    const soon=tasks.filter(t=>t.status!=='done'&&t.deadline&&Math.ceil((new Date(t.deadline)-TODAY)/86400000)<=7&&Math.ceil((new Date(t.deadline)-TODAY)/86400000)>=0).length;
    const projIds=[...new Set(tasks.map(t=>t.project_id))];
    document.getElementById('doerSub').textContent=`${total} task${total!==1?'s':''} across ${projIds.length} project(s) . ${done} completed`;
    document.getElementById('doerStats').innerHTML=[
      ['Assigned to Me',total,'sc-v-total'],['Overdue',over,'sc-v-over'],['Due This Week',soon,'sc-v-soon'],
      ['In Progress',tasks.filter(t=>['pending','inprogress'].includes(t.status)).length,'sc-v-ok'],
      ['Completed',done,'sc-v-done'],
    ].map(([l,v,c])=>`<div class="scard"><div class="sc-label">${l}</div><div class="sc-val ${c}">${v}</div></div>`).join('');
    if(!tasks.length){ document.getElementById('doerContent').innerHTML=`<div class="doer-proj-wrap"><div class="doer-empty"><strong>No tasks assigned to you</strong>Tasks assigned to "${S.name}" will appear here.</div></div>`; return; }
    const byProj={};
    tasks.forEach(t=>{ if(!byProj[t.project_id]) byProj[t.project_id]={name:t.project_name,colorIdx:t.color_index,tasks:[]}; byProj[t.project_id].tasks.push(t); });
    let html='';
    Object.values(byProj).forEach(pg=>{
      const done2=pg.tasks.filter(t=>t.status==='done').length, pct=Math.round(done2/pg.tasks.length*100), col=COLORS[pg.colorIdx%COLORS.length];
      const rows=pg.tasks.map((t,i)=>{
        const dc=dlCls(t.deadline),dn=dlNote(t.deadline),sc=STAT_CLS[t.status]||'ss-pending';
        const sopts=Object.entries(STAT_LABELS).map(([v,l])=>`<option value="${v}"${t.status===v?' selected':''}>${l}</option>`).join('');
        const prioCls=PRIO_CLS[t.priority]||'prio-med';
        return `<tr>
          <td class="rn">${String(i+1).padStart(2,'0')}</td>
          <td><div class="task-act"><span class="task-dot ${STAT_DOT[t.status]}"></span>${t.activity}</div>${t.action_steps?`<div class="task-what">${t.action_steps}</div>`:''}</td>
          <td class="who-cell">${t.assignees||'-'}</td>
          <td><select class="ssel prio-sel ${prioCls}" onchange="changePriority('${t.id}',this.value)"><option value="high"${t.priority==='high'?' selected':''}>High</option><option value="medium"${t.priority==='medium'?' selected':''}>Medium</option><option value="low"${t.priority==='low'?' selected':''}>Low</option></select></td>
          <td><span class="dl-badge ${dc}">${fmt(t.deadline)}</span>${dn?`<div class="dl-note">${dn}</div>`:''}</td>
          <td><select class="ssel ${sc}" onchange="doerStatusChange('${t.id}','${t.activity.replace(/'/g,"\\'")}',this.value,this,this.dataset.deadline||'${t.deadline||''}')">${sopts}</select></td>
          <td><textarea class="cmt-ta" rows="2" placeholder="Add a comment..." onblur="saveCmt('${t.id}',this,'dcmtts-${t.id}')" ${hasRoleCap('doer','add_comments')?'':'readonly'}></textarea><div class="cmt-ts" id="dcmtts-${t.id}"></div></td>
        </tr>`;
      }).join('');
      html+=`<div class="doer-proj-wrap"><div class="doer-proj-hd"><div class="doer-proj-title"><span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0;"></span>${pg.name}</div><div class="doer-proj-prog"><div class="doer-prog-mini"><div class="doer-prog-fill" style="width:${pct}%;background:${col}"></div></div><span>${done2}/${pg.tasks.length} done</span></div></div><div class="tbl-scroll"><table class="doer-table"><thead><tr><th>#</th><th>Task</th><th>SPOC</th><th>Priority</th><th>Deadline</th><th>Status</th><th>Comments</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    });
    document.getElementById('doerContent').innerHTML=html;
  } catch(e){ document.getElementById('doerContent').innerHTML=`<div class="doer-proj-wrap"><div class="doer-empty"><strong>Error loading tasks</strong>${e.message}</div></div>`; }
}

// -- MANAGER VIEW --
let selectedProjId=null, sortF='deadline', sortD=1, currentTasksCache=[];
let currentPage=1;
const TASKS_PER_PAGE=15;

async function renderManager() {
  document.getElementById('btnNewProj').style.display='inline-flex';
  document.getElementById('btnNewProj').disabled=!hasRoleCap(S.role,'create_projects');
  const btnNewUser = document.getElementById('btnNewUser');
  if(btnNewUser) btnNewUser.style.display = (S.role==='admin' || S.role==='manager') ? 'inline-flex' : 'none';
  document.getElementById('projGrid').innerHTML=`<div class="scard"><div class="sc-label">Loading...</div></div>`;
  try {
    const projects = await api('GET','/projects');
    document.getElementById('mgrSub').textContent=`${projects.length} project${projects.length!==1?'s':''} ${S.role==='admin'?'total':'you manage'}`;
    const allT=projects.reduce((a,p)=>a+(p.total_tasks||0),0);
    const over=projects.reduce((a,p)=>a+(p.overdue_tasks||0),0);
    const soon=projects.reduce((a,p)=>a+(p.due_this_week||0),0);
    const done=projects.reduce((a,p)=>a+(p.completed_tasks||0),0);
    document.getElementById('mgrStats').innerHTML=[
      ['Total Tasks',allT,'sc-v-total'],['Overdue',over,'sc-v-over'],['Due This Week',soon,'sc-v-soon'],
      ['Completed',done,'sc-v-done'],['Projects',projects.length,'sc-v-ok'],
    ].map(([l,v,c])=>`<div class="scard"><div class="sc-label">${l}</div><div class="sc-val ${c}">${v}</div></div>`).join('');
    const isAdmin=S.role==='admin';
    document.getElementById('projGrid').innerHTML=projects.map((p,ci)=>{
      const col=COLORS[(p.color_index||0)%COLORS.length];
      const canEdit=isAdmin||(S.managedProjects.includes(p.id));
      const managers=(p.managers||[]).map(m=>m.name).join(', ');
      return `<div class="proj-card" style="animation-delay:${ci*0.05}s">
        <div class="proj-card-bar" style="background:${col}"></div>
        <div class="proj-card-body">
          <div class="pc-name">${p.name}</div>
          <div class="pc-desc">${p.description||'No description.'}</div>
          <div class="pc-tags">
            <span class="pc-tag">${p.total_tasks} tasks</span>
            <span class="pc-tag">${managers}</span>
            ${p.overdue_tasks>0?`<span class="pc-tag pc-tag-red">${p.overdue_tasks} overdue</span>`:''}
            <span class="pc-tag">${p.progress_percentage}% done</span>
          </div>
          <div class="pc-prog-row"><span>Progress</span><span>${p.completed_tasks}/${p.total_tasks}</span></div>
          <div class="pc-prog-track"><div class="pc-prog-fill" style="width:${p.progress_percentage}%;background:${col}"></div></div>
        </div>
        <div class="proj-card-foot">
          <button class="btn btn-primary btn-sm" onclick="openProject('${p.id}')">View Tasks</button>
          ${canEdit?`<button class="btn btn-sm" onclick="openProjModal('${p.id}')">Edit</button>`:''}
          ${isAdmin?`<button class="btn btn-sm btn-danger" onclick="confirmDelProject('${p.id}','${p.name.replace(/'/g,"\\'")}')">Delete</button>`:''}
        </div>
      </div>`;
    }).join('');
    if(selectedProjId) renderTasks();
  } catch(e){ document.getElementById('projGrid').innerHTML=`<p style="color:red">${e.message}</p>`; }
}

async function openProject(pid) {
  selectedProjId=pid;
  currentPage=1;
  document.getElementById('taskSection').style.display='block';
  const projects = await api('GET','/projects');
  const p=projects.find(x=>x.id===pid)||{name:'',description:''};
  document.getElementById('tSecTitle').textContent=p.name;
  document.getElementById('tSecSub').textContent=p.description||'';
  document.getElementById('tSearch').value='';
  document.getElementById('tStatusF').value='';
  renderTasks();
  setTimeout(()=>document.getElementById('taskSection').scrollIntoView({behavior:'smooth',block:'start'}),50);
}
function closeTaskSection(){ selectedProjId=null; document.getElementById('taskSection').style.display='none'; }
function doSort(f){ if(sortF===f) sortD*=-1; else{sortF=f;sortD=1;} renderTasks(); }

async function renderTasks() {
  if(!selectedProjId) return;
  const q=(document.getElementById('tSearch').value||'').toLowerCase();
  const sf=document.getElementById('tStatusF').value;
  const canEdit=S.role==='admin'||(S.role==='manager'&&S.managedProjects.includes(selectedProjId));
  const canComment=hasRoleCap(S.role,'add_comments');
  try {
    let tasks = await api('GET',`/tasks?project_id=${selectedProjId}`);
    if(q) tasks=tasks.filter(t=>[t.activity,t.action_steps,t.support_needed,t.assignees].join(' ').toLowerCase().includes(q));
    if(sf) tasks=tasks.filter(t=>t.status===sf);
    // Populate SPOC filter without losing the current selection
    const prevSw = document.getElementById('tWhoF').value;
    const spocs=new Set(); tasks.forEach(t=>(t.assignees||'').split(' / ').filter(Boolean).forEach(s=>spocs.add(s)));
    document.getElementById('tWhoF').innerHTML='<option value="">All SPOCs</option>'+[...spocs].sort().map(s=>`<option value="${s}">${s}</option>`).join('');
    document.getElementById('tWhoF').value = prevSw;
    
    const sw=document.getElementById('tWhoF').value;
    if(sw) tasks=tasks.filter(t=>(t.assignees||'').toLowerCase().includes(sw.toLowerCase()));
    // Tasks are returned in creation order (created_at ASC) from the backend — no client sort
    currentTasksCache=tasks;
    const totalTasks=tasks.length;
    const totalPages=Math.max(1,Math.ceil(totalTasks/TASKS_PER_PAGE));
    if(currentPage>totalPages) currentPage=totalPages;
    if(currentPage<1) currentPage=1;
    const startIdx=(currentPage-1)*TASKS_PER_PAGE;
    const endIdx=Math.min(startIdx+TASKS_PER_PAGE,totalTasks);
    const pageTasks=tasks.slice(startIdx,endIdx);
    document.getElementById('tEmpty').style.display=totalTasks===0?'block':'none';
    document.getElementById('tFootText').textContent=`Showing ${startIdx+1}–${endIdx} of ${totalTasks} tasks`;
    // Render pagination
    renderPagination(totalPages,totalTasks);
    document.getElementById('tBody').innerHTML=pageTasks.map((t,i)=>{
      const globalIdx=startIdx+i;
      const dc=dlCls(t.deadline),dn=dlNote(t.deadline),sc=STAT_CLS[t.status]||'ss-pending';
      const sopts=Object.entries(STAT_LABELS).map(([v,l])=>`<option value="${v}"${t.status===v?' selected':''}>${l}</option>`).join('');
      const prioCls=PRIO_CLS[t.priority]||'prio-med';
      const dlCell=t.status==='deferred'&&canEdit?`<input type="date" class="dl-edit" id="dl-input-${t.id}" value="${t.deadline||''}" onchange="quickDlChange('${t.id}',this.value)">`:`<span class="dl-badge ${dc}" id="dl-badge-${t.id}">${fmt(t.deadline)}</span>`;
      const addBtn=canEdit?`<button class="add-row-btn" title="Insert new task below" onclick="addInlineTaskAfter('${t.id}',this)">+</button>`:'';
      return `<tr data-task-id="${t.id}">
        <td class="rn">${String(globalIdx+1).padStart(2,'0')}</td>
        <td><div class="task-act"><span class="task-dot ${STAT_DOT[t.status]}"></span>${t.activity}</div></td>
        <td><div class="task-what">${t.action_steps||'-'}</div></td>
        <td class="who-cell">${t.assignees||'-'}</td>
        <td><select class="ssel prio-sel ${prioCls}" onchange="changePriority('${t.id}',this.value)" ${canEdit?'':'disabled'}><option value="high"${t.priority==='high'?' selected':''}>High</option><option value="medium"${t.priority==='medium'?' selected':''}>Medium</option><option value="low"${t.priority==='low'?' selected':''}>Low</option></select></td>
        <td>${dlCell}<div class="dl-note" id="dl-note-${t.id}">${dn}</div></td>
        <td><select class="ssel ${sc}" onchange="mgrStatusChange('${t.id}','${t.activity.replace(/'/g,"\\'")}',this.value,this,'${t.deadline||''}')" ${canEdit?'':'disabled'}>${sopts}</select></td>
        <td><textarea class="cmt-ta" rows="2" placeholder="Add comment..." onblur="saveCmt('${t.id}',this,'mcmtts-${t.id}')" ${canComment?'':'readonly'}></textarea><div class="cmt-ts" id="mcmtts-${t.id}"></div></td>
        <td class="sup-cell">${t.support_needed||'-'}</td>
        <td style="white-space:nowrap">
          ${canEdit?`<button class="btn btn-sm" onclick="openTaskModal('${t.id}')">Edit</button> `:''}
          ${S.role==='admin'?`<button class="btn btn-sm btn-danger" onclick="confirmDelTask('${t.id}','${t.activity.replace(/'/g,"\\'")}')">Del</button> `:''}
          <button class="btn btn-sm btn-mail" title="Send reminder email" onclick="sendTaskMail('${t.id}','${t.activity.replace(/'/g,"\\'")}')">&#9993;</button>
          ${addBtn}
        </td>
      </tr>`;
    }).join('');
  } catch(e){ document.getElementById('tBody').innerHTML=`<tr><td colspan="10" style="color:red;padding:20px">${e.message}</td></tr>`; }
}

// -- PAGINATION -------------------------------------------
function renderPagination(totalPages,totalTasks){
  const pg=document.getElementById('tPagination');
  if(totalPages<=1){pg.innerHTML='';return;}
  let html='';
  html+=`<button class="pg-btn" ${currentPage===1?'disabled':''} onclick="goToPage(1)" title="First page">&laquo;</button>`;
  html+=`<button class="pg-btn" ${currentPage===1?'disabled':''} onclick="goToPage(${currentPage-1})" title="Previous">&lsaquo;</button>`;
  // Show page numbers
  let startP=Math.max(1,currentPage-2);
  let endP=Math.min(totalPages,startP+4);
  if(endP-startP<4) startP=Math.max(1,endP-4);
  if(startP>1) html+='<span class="pg-info">...</span>';
  for(let p=startP;p<=endP;p++){
    html+=`<button class="pg-btn ${p===currentPage?'pg-active':''}" onclick="goToPage(${p})">${p}</button>`;
  }
  if(endP<totalPages) html+='<span class="pg-info">...</span>';
  html+=`<button class="pg-btn" ${currentPage===totalPages?'disabled':''} onclick="goToPage(${currentPage+1})" title="Next">&rsaquo;</button>`;
  html+=`<button class="pg-btn" ${currentPage===totalPages?'disabled':''} onclick="goToPage(${totalPages})" title="Last page">&raquo;</button>`;
  pg.innerHTML=html;
}
function goToPage(p){
  currentPage=p;
  renderTasks();
  document.getElementById('taskSection').scrollIntoView({behavior:'smooth',block:'start'});
}

// -- STATUS CHANGE --------------------------------------
let pendingChange=null;
function doerStatusChange(taskId,activity,newStatus,selEl,currentDeadline){
  pendingChange={taskId,newStatus,selEl};
  document.getElementById('reasonSub').textContent=`"${activity.slice(0,50)}" ? ${STAT_LABELS[newStatus]||newStatus}`;
  document.getElementById('rDlField').style.display=newStatus==='deferred'?'block':'none';
  document.getElementById('rDl').value=currentDeadline||'';
  document.getElementById('rReason').value='';
  document.getElementById('rTaskId').value=taskId;
  document.getElementById('rNewStatus').value=newStatus;
  document.getElementById('modalReason').classList.add('open');
}
function mgrStatusChange(taskId,activity,newStatus,selEl,currentDeadline){doerStatusChange(taskId,activity,newStatus,selEl,currentDeadline);}
function cancelReason(){pendingChange=null;document.getElementById('modalReason').classList.remove('open');if(currentTab==='doer')renderDoer();else renderTasks();}
async function confirmReason(){
  const taskId=document.getElementById('rTaskId').value;
  const newStatus=document.getElementById('rNewStatus').value;
  const reason=document.getElementById('rReason').value.trim();
  const newDl=document.getElementById('rDl').value;
  try{await api('PUT',`/tasks/${taskId}/status`,{new_status:newStatus,reason:reason||'(no reason given)',new_deadline:newDl||null});document.getElementById('modalReason').classList.remove('open');showSaved();if(currentTab==='doer')renderDoer();else renderTasks();buildTabs();}
  catch(e){alert('Failed to update status: '+e.message);}
}
async function quickDlChange(taskId,newDl){
  try{
    await api('PUT',`/tasks/${taskId}/status`,{new_status:'deferred',reason:'Deadline updated',new_deadline:newDl});
    showSaved();
    // Update only the deadline cell — do NOT re-render the table (task must stay in place)
    const badge=document.getElementById(`dl-badge-${taskId}`);
    const note=document.getElementById(`dl-note-${taskId}`);
    if(badge){badge.className=`dl-badge ${dlCls(newDl)}`;badge.textContent=fmt(newDl);}
    if(note) note.textContent=dlNote(newDl);
  }catch(e){alert(e.message);}
}
async function changePriority(taskId,newPriority){
  try{
    await api('PUT',`/tasks/${taskId}/priority`,{new_priority:newPriority});
    showSaved();
    // Just update the select colour — don't re-render
    const sel=document.querySelector(`select[onchange*="changePriority('${taskId}'"]`);
    if(sel){sel.className=`ssel prio-sel ${PRIO_CLS[newPriority]||'prio-med'}`;}
  }catch(e){alert(e.message);}
}

// -- MAIL -------------------------------------------------------
async function sendTaskMail(taskId, activityName) {
  try {
    const result = await api('POST', `/tasks/${taskId}/send-reminder`, {});
    alert(`✅ Reminder sent!\n\nRecipients: ${result.recipients.join(', ')}`);
  } catch(e) {
    alert(`❌ Failed to send email:\n${e.message}`);
  }
}

async function saveCmt(taskId,ta,tsId){
  const el=typeof ta==='string'?document.getElementById(ta):ta;
  const content=el.value;
  if(!content.trim())return;
  try{
    await api('POST',`/tasks/${taskId}/comments`,{content});
    const tsEl=document.getElementById(tsId);if(tsEl)tsEl.textContent='Saved '+fmtTs(Date.now());
    // Update the Support Needed cell in the same row
    const row=el.closest('tr');
    if(row){const supCell=row.querySelector('.sup-cell');if(supCell)supCell.textContent=content.trim();}
    // Clear the comment textarea after saving
    el.value='';
    showSaved();
  }
  catch(e){alert('Failed to save comment: '+e.message);}
}

// -- PROJECT CRUD ---------------------------------------
async function openProjModal(pid){
  document.getElementById('projMTitle').textContent=pid?'Edit Project':'New Project';
  document.getElementById('projMId').value=pid||'';
  document.getElementById('pmName').value='';document.getElementById('pmDesc').value='';
  document.getElementById('pmManagers').value='';document.getElementById('pmTempManagers').value='';
  if(pid){try{const p=await api('GET',`/projects/${pid}`);document.getElementById('pmName').value=p.name||'';document.getElementById('pmDesc').value=p.description||'';if(p.managers)document.getElementById('pmManagers').value=p.managers.map(m=>m.name).join(', ');}catch(e){}}
  const pick=document.getElementById('pmTempPick');
  if(pick){pick.innerHTML='<option value="">Select person to add as project manager</option>'+ALL_USERS.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');}
  document.getElementById('modalProj').classList.add('open');
}
function addTempManagerFromModal(){
  const pick=document.getElementById('pmTempPick');if(!pick||!pick.value)return;
  const name=pick.options[pick.selectedIndex].textContent;
  const tempEl=document.getElementById('pmTempManagers');
  const curr=(tempEl.value||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!curr.map(s=>s.toLowerCase()).includes(name.toLowerCase()))curr.push(name);
  tempEl.value=curr.join(', ');pick.value='';
}
async function saveProject(){
  const pid=document.getElementById('projMId').value;
  const name=document.getElementById('pmName').value.trim();if(!name){alert('Project name required');return;}
  const description=document.getElementById('pmDesc').value.trim();
  const allNames=[...new Set([...(document.getElementById('pmManagers').value||'').split(','),...(document.getElementById('pmTempManagers').value||'').split(',')].map(s=>s.trim()).filter(Boolean))];
  const manager_ids=ALL_USERS.filter(u=>allNames.some(n=>n.toLowerCase()===u.name.toLowerCase())).map(u=>u.id);
  try{
    let saved;
    if(pid) saved=await api('PUT',`/projects/${pid}`,{name,description,manager_ids});
    else saved=await api('POST','/projects',{name,description,color_index:Math.floor(Math.random()*8),manager_ids});
    closeModal('modalProj');showSaved();
    const me=await api('GET','/auth/me');S.role=me.role;S.managedProjects=me.managedProjects||[];
    document.getElementById('uRole').textContent={admin:'Admin',manager:'Manager',doer:'Task Doer'}[S.role]||S.role;
    buildTabs();
    if(currentTab==='manager'){
      await renderManager();
      // Auto-open the newly created project so tasks can be added immediately
      if(!pid && saved && saved.id) openProject(saved.id);
    }
  }catch(e){alert('Failed to save project: '+e.message);}
}
function confirmDelProject(pid,name){
  document.getElementById('delTitle').textContent='Delete Project';
  document.getElementById('delSub').textContent=`Delete "${name}" and all its tasks? This cannot be undone.`;
  document.getElementById('delConfirmBtn').onclick=async()=>{try{await api('DELETE',`/projects/${pid}`);closeModal('modalDel');showSaved();if(selectedProjId===pid){selectedProjId=null;document.getElementById('taskSection').style.display='none';}renderManager();}catch(e){alert(e.message);}};
  document.getElementById('modalDel').classList.add('open');
}

// -- TASK CRUD ------------------------------------------
let _inlineRowCounter=0;
let _inlineSavedCount=0;

function _createInlineRowHtml(uid, num){
  const userOpts=ALL_USERS.map(u=>`<option value="${u.name}">${u.name}</option>`).join('');
  const statusOpts=Object.entries(STAT_LABELS).map(([v,l])=>`<option value="${v}"${v==='pending'?' selected':''}>${l}</option>`).join('');
  return `
    <td class="rn" style="color:var(--blue-t);font-weight:700">${num}</td>
    <td><textarea class="fi it-name-field" data-uid="${uid}" rows="1" placeholder="Task / Activity name *"></textarea></td>
    <td><textarea class="fi it-what-field" data-uid="${uid}" rows="1" placeholder="Action steps"></textarea></td>
    <td><input class="fi it-who-field" data-uid="${uid}" list="it-who-list-${uid}" placeholder="SPOC name"><datalist id="it-who-list-${uid}">${userOpts}</datalist></td>
    <td><select class="ssel prio-sel prio-med it-priority-field" data-uid="${uid}">
      <option value="high">High</option>
      <option value="medium" selected>Medium</option>
      <option value="low">Low</option>
    </select></td>
    <td><input class="fi it-dl-field" data-uid="${uid}" type="date"></td>
    <td><select class="ssel ss-pending it-status-field" data-uid="${uid}">${statusOpts}</select></td>
    <td><textarea class="cmt-ta it-comment-field" data-uid="${uid}" rows="1" placeholder="Comment (optional)"></textarea></td>
    <td><textarea class="fi it-support-field" data-uid="${uid}" rows="1" placeholder="Support needed"></textarea></td>
    <td>
      <div class="it-actions">
        <button class="btn btn-primary btn-sm" onclick="saveInlineRow('${uid}')">Save</button>
        <button class="btn btn-sm" onclick="cancelInlineRow('${uid}')">Cancel</button>
      </div>
    </td>`;
}

function _insertInlineRow(afterElement, num){
  const uid='ilr-'+(_inlineRowCounter++);
  const row=document.createElement('tr');
  row.id=uid;
  row.className='inline-new-task-row';
  row.style.background='var(--surface)';
  row.innerHTML=_createInlineRowHtml(uid, num);
  const tbody=document.getElementById('tBody');
  if(afterElement && afterElement.nextSibling){
    tbody.insertBefore(row, afterElement.nextSibling);
  } else {
    // Always append at the END
    tbody.appendChild(row);
  }
  // live color updates
  row.querySelector('.it-priority-field').addEventListener('change',function(){this.className=`ssel prio-sel ${PRIO_CLS[this.value]||'prio-med'} it-priority-field`;});
  row.querySelector('.it-status-field').addEventListener('change',function(){this.className=`ssel ${STAT_CLS[this.value]||'ss-pending'} it-status-field`;});
  // auto-expand text inputs on typing
  row.querySelectorAll('.it-name-field,.it-what-field,.it-who-field,.it-support-field').forEach(inp=>{
    inp.addEventListener('input',function(){
      // Use a hidden measurer to check if content overflows
      this.style.height='auto';
      if(this.scrollHeight>this.clientHeight){
        this.style.height=this.scrollHeight+'px';
      }
    });
  });
  // auto-expand comment textarea
  const cmt=row.querySelector('.it-comment-field');
  if(cmt) cmt.addEventListener('input',function(){this.style.height='auto';this.style.height=this.scrollHeight+'px';});
  return row;
}

// Add a single new task row at end
function addInlineTask(){
  const existingInline=document.querySelectorAll('.inline-new-task-row').length;
  const num=currentTasksCache.length+existingInline+1;
  const row=_insertInlineRow(null, String(num).padStart(2,'0'));
  row.querySelector('.it-name-field').focus();
  row.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// Add a new task row AFTER a specific task row (triggered by the per-row + icon)
function addInlineTaskAfter(taskId, btnEl){
  const taskRow=btnEl.closest('tr');
  const existingInline=document.querySelectorAll('.inline-new-task-row').length;
  const num=currentTasksCache.length+existingInline+1;
  const row=_insertInlineRow(taskRow, String(num).padStart(2,'0'));
  row.querySelector('.it-name-field').focus();
  row.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// Save an individual inline row
async function saveInlineRow(uid){
  const row=document.getElementById(uid);
  if(!row) return;
  const nameEl=row.querySelector('.it-name-field');
  const activity=(nameEl.value||'').trim();
  if(!activity){nameEl.focus();nameEl.style.borderColor='var(--red)';return;}
  const whoNames=(row.querySelector('.it-who-field').value||'').split(/[\/,+&]/).map(s=>s.trim()).filter(Boolean);
  const assignee_ids=ALL_USERS.filter(u=>whoNames.some(n=>n.toLowerCase()===u.name.toLowerCase())).map(u=>u.id);
  const assigneeNames=whoNames.join(' / ')||'-';
  const data={
    activity,
    action_steps:(row.querySelector('.it-what-field').value||'').trim(),
    priority:row.querySelector('.it-priority-field').value||'medium',
    deadline:row.querySelector('.it-dl-field').value||null,
    status:row.querySelector('.it-status-field').value||'pending',
    support_needed:(row.querySelector('.it-support-field').value||'').trim(),
    assignee_ids,
    project_id:selectedProjId
  };
  try{
    const saved=await api('POST','/tasks',data);
    _inlineSavedCount++;
    showSaved();
    // Convert inline row into a normal task row in-place
    const canEdit=S.role==='admin'||(S.role==='manager'&&S.managedProjects.includes(selectedProjId));
    const canComment=hasRoleCap(S.role,'add_comments');
    const t={...saved, activity:data.activity, action_steps:data.action_steps, priority:data.priority, deadline:data.deadline, status:data.status, support_needed:data.support_needed, assignees:assigneeNames, id:saved.id};
    const rowNum=row.querySelector('td.rn').textContent;
    const dc=dlCls(t.deadline),dn=dlNote(t.deadline),sc=STAT_CLS[t.status]||'ss-pending';
    const sopts=Object.entries(STAT_LABELS).map(([v,l])=>`<option value="${v}"${t.status===v?' selected':''}>${l}</option>`).join('');
    const prioCls=PRIO_CLS[t.priority]||'prio-med';
    const dlCell=`<span class="dl-badge ${dc}" id="dl-badge-${t.id}">${fmt(t.deadline)}</span>`;
    const addBtn=canEdit?`<button class="add-row-btn" title="Insert new task below" onclick="addInlineTaskAfter('${t.id}',this)">+</button>`:'';
    row.className='';
    row.removeAttribute('id');
    row.style.background='';
    row.setAttribute('data-task-id',t.id);
    row.innerHTML=`
        <td class="rn">${rowNum}</td>
        <td><div class="task-act"><span class="task-dot ${STAT_DOT[t.status]}"></span>${t.activity}</div></td>
        <td><div class="task-what">${t.action_steps||'-'}</div></td>
        <td class="who-cell">${t.assignees||'-'}</td>
        <td><select class="ssel prio-sel ${prioCls}" onchange="changePriority('${t.id}',this.value)" ${canEdit?'':'disabled'}><option value="high"${t.priority==='high'?' selected':''}>High</option><option value="medium"${t.priority==='medium'?' selected':''}>Medium</option><option value="low"${t.priority==='low'?' selected':''}>Low</option></select></td>
        <td>${dlCell}<div class="dl-note" id="dl-note-${t.id}">${dn}</div></td>
        <td><select class="ssel ${sc}" onchange="mgrStatusChange('${t.id}','${t.activity.replace(/'/g,"\\\\'")}',this.value,this,'${t.deadline||''}')" ${canEdit?'':'disabled'}>${sopts}</select></td>
        <td><textarea class="cmt-ta" rows="2" placeholder="Add comment..." onblur="saveCmt('${t.id}',this,'mcmtts-${t.id}')" ${canComment?'':'readonly'}></textarea><div class="cmt-ts" id="mcmtts-${t.id}"></div></td>
        <td class="sup-cell">${t.support_needed||'-'}</td>
        <td style="white-space:nowrap">
          ${canEdit?`<button class="btn btn-sm" onclick="openTaskModal('${t.id}')">Edit</button> `:''}
          ${S.role==='admin'?`<button class="btn btn-sm btn-danger" onclick="confirmDelTask('${t.id}','${t.activity.replace(/'/g,"\\\\'")}')">Del</button> `:''}
          <button class="btn btn-sm btn-mail" title="Send reminder email" onclick="sendTaskMail('${t.id}','${t.activity.replace(/'/g,"\\\\'")}')">&#9993;</button>
          ${addBtn}
        </td>`;
    // Brief green flash to confirm save
    row.style.animation='flashGreen .5s ease';
    setTimeout(()=>row.style.animation='',600);
    // Renumber remaining inline rows
    _renumberInlineRows();
    // If no inline rows left, do full refresh to sync everything
    const remaining=document.querySelectorAll('.inline-new-task-row');
    if(remaining.length===0){
      _inlineSavedCount=0;
      renderTasks();
      renderDoer();
      renderManager();
      buildTabs();
    }
  }catch(e){alert('Failed to save task: '+e.message);}
}

// Cancel (remove) a single inline row
function cancelInlineRow(uid){
  const row=document.getElementById(uid);
  if(row) row.remove();
  _renumberInlineRows();
}

// Renumber all inline rows sequentially after any add/remove
function _renumberInlineRows(){
  const rows=document.querySelectorAll('.inline-new-task-row');
  const base=currentTasksCache.length+_inlineSavedCount;
  rows.forEach((r,i)=>{
    const td=r.querySelector('td.rn');
    if(td) td.textContent=String(base+i+1).padStart(2,'0');
  });
}

// Cancel ALL inline rows
function cancelAllInlineRows(){
  document.querySelectorAll('.inline-new-task-row').forEach(r=>r.remove());
  if(_inlineSavedCount>0){
    _inlineSavedCount=0;
    renderTasks();
    renderManager();
    buildTabs();
  }
}

// -- ADD TASKS MODAL ---------------------------
function openAddTasksModal(){
  document.getElementById('antRowCount').value=5;
  document.getElementById('modalAddTasks').classList.add('open');
  setTimeout(()=>document.getElementById('antRowCount').focus(),100);
}
async function confirmAddTaskRows(){
  let count=parseInt(document.getElementById('antRowCount').value)||1;
  if(count<1) count=1;
  if(count>30) count=30;
  closeModal('modalAddTasks');
  // Remove any existing inline rows first
  cancelAllInlineRows();
  // Navigate to last page so we can see the appended rows
  const totalPages=Math.max(1,Math.ceil(currentTasksCache.length/TASKS_PER_PAGE));
  currentPage=totalPages;
  // Wait for render to finish before inserting rows
  await renderTasks();
  // Add rows at the end
  const baseNum=currentTasksCache.length;
  for(let i=0;i<count;i++){
    _insertInlineRow(null, String(baseNum+i+1).padStart(2,'0'));
  }
  // Focus the first new row's name field and scroll to it
  const firstRow=document.querySelector('.inline-new-task-row');
  if(firstRow){
    firstRow.querySelector('.it-name-field').focus();
    firstRow.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
}

// Legacy compatibility: keep old function names working
function addInlineTaskLegacy(){addInlineTask();}
function cancelInlineTask(){cancelAllInlineRows();}
async function openTaskModal(tid){
  if(!tid){addInlineTask();return;}
  document.getElementById('taskMTitle').textContent='Edit Task';
  document.getElementById('taskMId').value=tid;
  document.getElementById('tmName').value='';document.getElementById('tmWhat').value='';
  document.getElementById('tmWho').value='';document.getElementById('tmPriority').value='2';
  document.getElementById('tmDl').value='';document.getElementById('tmStatus').value='pending';document.getElementById('tmSupport').value='';
  try{const t=await api('GET',`/tasks/${tid}`);document.getElementById('tmName').value=t.activity||'';document.getElementById('tmWhat').value=t.action_steps||'';document.getElementById('tmWho').value=t.assignees||'';document.getElementById('tmPriority').value=t.priority==='high'?'1':t.priority==='low'?'3':'2';document.getElementById('tmDl').value=t.deadline?String(t.deadline).split('T')[0]:'';document.getElementById('tmStatus').value=t.status||'pending';document.getElementById('tmSupport').value=t.support_needed||'';}catch(e){console.error('openTaskModal error:',e);}
  document.getElementById('modalTask').classList.add('open');
}
async function saveTask(){
  const tid=document.getElementById('taskMId').value;
  const activity=document.getElementById('tmName').value.trim();if(!activity){alert('Task name required');return;}
  const whoNames=(document.getElementById('tmWho').value||'').split(/[\/,+&]/).map(s=>s.trim()).filter(Boolean);
  const assignee_ids=ALL_USERS.filter(u=>whoNames.some(n=>n.toLowerCase()===u.name.toLowerCase())).map(u=>u.id);
  const priMap={'1':'high','2':'medium','3':'low'};
  const data={activity,action_steps:document.getElementById('tmWhat').value.trim(),priority:priMap[document.getElementById('tmPriority').value]||'medium',deadline:document.getElementById('tmDl').value||null,status:document.getElementById('tmStatus').value,support_needed:document.getElementById('tmSupport').value.trim(),assignee_ids,project_id:selectedProjId};
  try{if(tid)await api('PUT',`/tasks/${tid}`,data);closeModal('modalTask');showSaved();if(selectedProjId)renderTasks();renderDoer();renderManager();buildTabs();}
  catch(e){alert('Failed to save task: '+e.message);}
}
function confirmDelTask(tid,name){
  document.getElementById('delTitle').textContent='Delete Task';
  document.getElementById('delSub').textContent=`Delete "${name}"? This cannot be undone.`;
  document.getElementById('delConfirmBtn').onclick=async()=>{try{await api('DELETE',`/tasks/${tid}`);closeModal('modalDel');showSaved();renderTasks();renderManager();}catch(e){alert(e.message);}};
  document.getElementById('modalDel').classList.add('open');
}

// -- USER ACCESS CONTROL --------------------------------
async function renderUserAccess(){
  // Clear old static HTML immediately to prevent flicker
  const wrap = document.getElementById('viewUserAccess').querySelector('.rbac-wrap');
  if(wrap) wrap.innerHTML='<div style="padding:32px;text-align:center;color:var(--t3)">Loading...</div>';
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
        `<td style="text-align:center"><input type="checkbox" ${c[k] ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} onchange="toggleRoleCap('${c.role}','${k}',this.checked)"></td>`
      ).join('');
      return `<tr><td style="font-weight:600;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--t2);padding:10px 14px">${c.role}</td>${cells}</tr>`;
    }).join('');

    const headers = capKeys.map(k =>
      `<th style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;text-align:center;padding:10px 14px">${capLabels[k]}</th>`
    ).join('');

    wrap.innerHTML = `
      <div class="rbac-title">Role Capabilities</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;margin-top:14px">
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;text-align:left;padding:10px 14px">ROLE</th>
            ${headers}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  } catch(e) { console.error('renderUserAccess error:', e); }
}

async function toggleRoleCap(role,cap,value){
  if(S.role!=='admin'){alert('Only Admin can change role capabilities.');return;}
  const current={...ROLE_CAPS[role]};current[cap]=!!value;
  try{await api('PUT',`/role-capabilities/${role}`,current);showSaved();renderUserAccess();}catch(e){alert(e.message);}
}
async function changeUserRole(userId,newRole){
  if(S.role!=='admin'){alert('Only Admin can change roles.');return;}
  const user=ALL_USERS.find(u=>u.id===userId);if(!user)return;
  try{await api('PUT',`/users/${userId}`,{name:user.name,email:user.email,role:newRole});showSaved();renderUserAccess();}catch(e){alert(e.message);}
}
async function deleteUser(userId,name){
  if(S.role!=='admin'){alert('Only Admin can delete users.');return;}
  if(!confirm(`Delete user "${name}"? This cannot be undone.`))return;
  try{await api('DELETE',`/users/${userId}`);showSaved();renderUserAccess();buildLoginDropdown();}catch(e){alert(e.message);}
}
async function openNewUserModal(){
  if(S.role!=='admin' && S.role!=='manager'){alert('Only Admin or Manager can add users.');return;}
  document.getElementById('userModalTitle').textContent='Add New User';
  document.getElementById('userEditName').value='';document.getElementById('umName').value='';document.getElementById('umEmail').value='';
  const sel=document.getElementById('umProject');
  try{const projects=await api('GET','/projects');sel.innerHTML='<option value="">-- No project selected --</option>'+projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');}
  catch(e){sel.innerHTML='<option value="">-- No project selected --</option>';}
  document.getElementById('modalNewUser').classList.add('open');
}
async function saveNewUser(){
  if(S.role!=='admin' && S.role!=='manager'){alert('Only Admin or Manager can save user changes.');return;}
  const name=document.getElementById('umName').value.trim();
  const email=document.getElementById('umEmail').value.trim().toLowerCase();
  const project_id=document.getElementById('umProject').value;
  if(!name){alert('User name required');return;}
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){alert('Please enter a valid email');return;}
  try{await api('POST','/users',{name,email:email||null,role:'doer',project_id:project_id||null});closeModal('modalNewUser');showSaved();alert(`User "${name}" added successfully!`);ALL_USERS=await api('GET','/auth/people');if(currentTab==='userAccess')renderUserAccess();buildTabs();}
  catch(e){alert('Failed to add user: '+e.message);}
}

// -- UTILS & BOOT ---------------------------------------
function toggleHist(id){const el=document.getElementById(id);if(el)el.classList.toggle('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-ov').forEach(el=>el.addEventListener('click',function(e){if(e.target===this)closeModal(this.id);}));

// On page load: check if user already has an active session
(async function boot() {
  try {
    const me = await api('GET','/auth/me');
    if(me && me.id) {
      // Session is still valid — restore it
      S = {id:me.id, name:me.name, role:me.role, managedProjects:me.managedProjects||[]};
      ALL_USERS = await api('GET','/auth/people');
      const caps = await api('GET','/role-capabilities');
      ROLE_CAPS = {};
      caps.forEach(c => { ROLE_CAPS[c.role] = c; });
      document.getElementById('loginScreen').style.display='none';
      const app=document.getElementById('appShell'); app.style.display='flex'; app.style.flexDirection='column';
      const initials=me.name.split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
      document.getElementById('uAvatar').textContent=initials;
      document.getElementById('uName').textContent=me.name;
      document.getElementById('uRole').textContent={admin:'Admin',manager:'Manager',doer:'Task Doer'}[S.role]||S.role;
      buildTabs();
      switchTab(S.role==='doer'?'doer':'manager');
      return;
    }
  } catch(e) {
    // No active session — fall through to login screen
  }
  // Show login screen
  document.getElementById('loginScreen').style.display='flex';
  buildLoginDropdown();
})();

