// ============================================
//  EMAIL SERVICE — nodemailer + Handlebars
//  Supports Gmail & Outlook SMTP
// ============================================

const nodemailer  = require('nodemailer');
const handlebars  = require('handlebars');
const fs          = require('fs');
const path        = require('path');

// ── Load & compile the reminder template once at startup ──
const templatePath = path.join(__dirname, '../emails/reminder.hbs');
const templateSrc  = fs.readFileSync(templatePath, 'utf8');
const reminderTemplate = handlebars.compile(templateSrc);

// ── Build transporter based on sender's email domain ──
function createTransporter() {
    const email = process.env.MAIL_USER || '';
    const isOutlook = email.toLowerCase().includes('outlook') ||
                      email.toLowerCase().includes('hotmail') ||
                      email.toLowerCase().includes('live.') ||
                      (process.env.MAIL_PROVIDER || '').toLowerCase() === 'outlook';

    if (isOutlook) {
        return nodemailer.createTransport({
            host:   'smtp.office365.com',
            port:   587,
            secure: false,
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASS,
            },
            tls: { ciphers: 'SSLv3' }
        });
    }

    // Default: Gmail
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,   // Use App Password, not your Google account password
        }
    });
}

// ── Deadline helpers ──
const STATUS_LABELS = {
    pending: 'Pending', inprogress: 'In Progress', review: 'Under Review',
    deferred: 'Deferred', blocked: 'Blocked', done: 'Done'
};

const PRIORITY_LABELS = { high: 'P1 — High', medium: 'P2 — Medium', low: 'P3 — Low' };

function deadlineInfo(dateStr) {
    if (!dateStr) return { label: '—', note: '', bg: '#f1f5f9', color: '#475569' };
    const d    = new Date(dateStr);
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.ceil((d - today) / 86400000);
    const label = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    if (diff < 0)  return { label, note: `${Math.abs(diff)}d overdue`, bg: '#fef2f2', color: '#991b1b' };
    if (diff === 0) return { label, note: 'Due today',                  bg: '#fff7ed', color: '#9a3412' };
    if (diff <= 7)  return { label, note: `${diff}d left`,              bg: '#fff7ed', color: '#9a3412' };
    if (diff <= 21) return { label, note: `${diff}d left`,              bg: '#f0fdf4', color: '#166534' };
    return { label, note: '', bg: '#f1f5f9', color: '#475569' };
}

function alertMeta(deadline) {
    if (!deadline) return { bg: '#eff6ff', color: '#1e40af', icon: '📋', label: 'Task Reminder' };
    const today = new Date(); today.setHours(0,0,0,0);
    const diff  = Math.ceil((new Date(deadline) - today) / 86400000);
    if (diff < 0)  return { bg: '#fef2f2', color: '#991b1b', icon: '🔴', label: 'OVERDUE TASK' };
    if (diff <= 7) return { bg: '#fff7ed', color: '#9a3412', icon: '🟠', label: 'DUE THIS WEEK' };
    return { bg: '#eff6ff', color: '#1e40af', icon: '📋', label: 'Task Reminder' };
}

// ── Main send function ──
async function sendTaskReminder({ task, project, assigneeEmails, assigneeNames, senderName }) {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        throw new Error('Email not configured. Add MAIL_USER and MAIL_PASS to .env');
    }

    const dl     = deadlineInfo(task.deadline);
    const alert  = alertMeta(task.deadline);

    // Build the plain deadline sentence
    let deadlineMessage = '';
    if (!task.deadline) {
        deadlineMessage = `The task "<strong>${task.activity}</strong>" has no deadline set.`;
    } else {
        const d    = new Date(task.deadline);
        const today = new Date(); today.setHours(0,0,0,0);
        const diff  = Math.ceil((d - today) / 86400000);
        const ddmmyyyy = d.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' });

        if (diff < 0) {
            deadlineMessage = `The task "<strong>${task.activity}</strong>" is overdue by <strong>${Math.abs(diff)} day${Math.abs(diff)===1?'':'s'}</strong>. The deadline was <strong>${ddmmyyyy}</strong>.`;
        } else if (diff === 0) {
            deadlineMessage = `The task "<strong>${task.activity}</strong>" is due <strong>today</strong> (${ddmmyyyy}).`;
        } else {
            deadlineMessage = `The task "<strong>${task.activity}</strong>" is reaching its deadline in <strong>${diff} day${diff===1?'':'s'}</strong>. The deadline is <strong>${ddmmyyyy}</strong>.`;
        }
    }

    const html = reminderTemplate({
        recipientName:   assigneeNames.join(', '),
        senderName,
        taskName:        task.activity,
        projectName:     project.name,
        deadlineMessage,
        alertBg:         alert.bg,
        alertColor:      alert.color,
        alertIcon:       alert.icon,
        alertLabel:      alert.label,
        appUrl:          process.env.APP_URL || 'http://localhost:3000',
    });

    const transporter = createTransporter();

    const info = await transporter.sendMail({
        from:    `"WWW Task Tracker" <${process.env.MAIL_USER}>`,
        replyTo: `"${senderName}" <${process.env.MAIL_USER}>`,
        to:      assigneeEmails.join(', '),
        subject: `${alert.icon} Task Reminder — ${task.activity}`,
        html,
        text: `Task Reminder: ${task.activity}\nProject: ${project.name}\n${deadlineMessage}\n\nPlease check the tracker for more details.`,
        messageId: `<${Date.now()}.${Math.random().toString(36).substring(2)}@tasktracker.local>`,
    });

    return info;
}

module.exports = { sendTaskReminder };
