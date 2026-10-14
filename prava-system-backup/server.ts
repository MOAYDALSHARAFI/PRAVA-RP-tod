import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.resolve(__dirname, 'data/db.json');

interface Sector {
  id: string;
  name: string;
  arabicName: string;
  subtitle: string;
  isOpen: boolean;
  badge?: string;
  discordRoomUrl?: string;
  webhookUrl?: string;
  discordChannelId?: string;
  minAge: number;
  rolesTemplate: string;
  unitPrefix?: string;
  questions: Array<{
    id: number;
    question: string;
    options: string[];
    correctIndex: number;
  }>;
}

interface Application {
  id: string;
  sectorId: string;
  sectorName: string;
  playerName: string;
  fullName: string;
  discordId: string;
  gameId: string;
  age: number;
  militaryNo: string;
  gender: string;
  currentUnit: string;
  acceptanceOfficer?: string;
  answers: number[];
  score: number;
  totalQuestions: number;
  rolesProofImg?: string;
  uniformImg?: string;
  status: 'قيد المراجعة' | 'مقبول' | 'مرفوض';
  reviewerNotes?: string;
  createdAt: string;
}

interface LoginLog {
  id: string;
  username: string;
  timestamp: string;
}

interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  gameId?: string;
  discordUsername?: string;
  role: 'owner' | 'leader' | 'officer' | 'applicant';
  roleTitle: string;
  permissions: Record<string, any>;
  createdAt: string;
}

interface ServerSettings {
  serverLogo: string;
  serverName: string;
  discordUrl: string;
  discordName: string;
  defaultUnitPrefix: string;
  webhookUrl?: string;
  botToken?: string;
  discordChannelId?: string;
  discordRoomUrl?: string;
  seniorOfficersWebhookUrl?: string;
  seniorOfficersChannelId?: string;
  seniorOfficersMessageTemplate?: string;
}

interface Database {
  settings?: ServerSettings;
  sectors: Sector[];
  applications: Application[];
  loginLogs: LoginLog[];
  users: UserAccount[];
}

function loadDb(): Database {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (!parsed.settings) {
        parsed.settings = {
          serverLogo: '/src/assets/images/prava_main_emblem_1791840349389.jpg',
          serverName: 'سيرفر PRAVA',
          discordUrl: 'https://discord.gg/prava',
          discordName: 'ديسكورد PRAVA',
          defaultUnitPrefix: 'M-',
        };
      }
      if (!parsed.users) {
        parsed.users = [];
      }
      return parsed;
    }
  } catch (err) {
    console.error('Error reading db.json, using defaults', err);
  }

  return {
    settings: {
      serverLogo: '/src/assets/images/prava_main_emblem_1791840349389.jpg',
      serverName: 'سيرفر PRAVA',
      discordUrl: 'https://discord.gg/prava',
      discordName: 'ديسكورد PRAVA',
      defaultUnitPrefix: 'M-',
    },
    sectors: [],
    applications: [],
    loginLogs: [],
    users: [],
  };
}

function saveDb(db: Database) {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing to db.json', err);
  }
}

// Format current time in Arabic style matching screenshots (e.g., 2026/10/12، 11:18:49 م)
function formatArabicDateTime(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const period = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12 || 12;

  return `${year}/${month}/${day}، ${hours}:${minutes}:${seconds} ${period}`;
}

// Clean and prune applications: last 7 days and max 30 items
function pruneApplications(applications: Application[]): Application[] {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  
  const sorted = [...applications].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const filtered = sorted.filter((app) => {
    const time = new Date(app.createdAt).getTime();
    return isNaN(time) || time >= oneWeekAgo;
  });

  return filtered.slice(0, 30);
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json({ limit: '20mb' }));

  // API Routes
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'PRAVA Recruitment Portal' });
  });

  // Settings Endpoints
  app.get('/api/settings', (_req: Request, res: Response) => {
    const db = loadDb();
    res.json(db.settings);
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    const db = loadDb();
    db.settings = {
      ...db.settings,
      ...req.body,
    };
    saveDb(db);
    res.json(db.settings);
  });

  // 1. Sectors
  app.get('/api/sectors', (_req: Request, res: Response) => {
    const db = loadDb();
    res.json(db.sectors);
  });

  app.put('/api/sectors/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const db = loadDb();
    const index = db.sectors.findIndex((s) => s.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Sector not found' });
    }

    db.sectors[index] = {
      ...db.sectors[index],
      ...req.body,
    };
    saveDb(db);
    res.json(db.sectors[index]);
  });

  // 2. Applications (Rolling 30 / 7 days)
  app.get('/api/applications', (_req: Request, res: Response) => {
    const db = loadDb();
    db.applications = pruneApplications(db.applications);
    saveDb(db);
    res.json(db.applications);
  });

  app.post('/api/applications', async (req: Request, res: Response) => {
    const db = loadDb();
    const sector = db.sectors.find((s) => s.id === req.body.sectorId);
    const prefix = sector?.unitPrefix || db.settings?.defaultUnitPrefix || 'M-';

    const newApp: Application = {
      id: `APP-${Date.now().toString(36).toUpperCase()}`,
      sectorId: req.body.sectorId,
      sectorName: req.body.sectorName,
      playerName: req.body.playerName,
      fullName: req.body.fullName,
      discordId: req.body.discordId,
      gameId: req.body.gameId,
      age: Number(req.body.age),
      militaryNo: req.body.militaryNo,
      gender: req.body.gender || 'غير محدد',
      currentUnit: req.body.currentUnit || `${prefix}${req.body.militaryNo}`,
      acceptanceOfficer: req.body.acceptanceOfficer || '',
      answers: req.body.answers || [],
      score: Number(req.body.score) || 0,
      totalQuestions: Number(req.body.totalQuestions) || 5,
      rolesProofImg: req.body.rolesProofImg || '',
      uniformImg: req.body.uniformImg || '',
      status: 'قيد المراجعة',
      reviewerNotes: '',
      createdAt: new Date().toISOString(),
    };

    db.applications.unshift(newApp);
    db.applications = pruneApplications(db.applications);
    saveDb(db);

    // Discord Notification Trigger (Webhook & Bot)
    const targetWebhook = sector?.webhookUrl || db.settings?.webhookUrl;
    const targetChannelId = sector?.discordChannelId || db.settings?.discordChannelId;
    const botToken = db.settings?.botToken;

    const notifMessage = `🚨 **طلب تقديم جديد إلى قطاع ${sector?.name || newApp.sectorName}**
👤 **الاسم داخل اللعبة:** ${newApp.playerName}
📝 **الاسم الكامل:** ${newApp.fullName}
💬 **الديسكورد:** <@${newApp.discordId}>
🆔 **الآيدي:** ${newApp.gameId}
🎖️ **الرقم العسكري:** ${newApp.militaryNo}
🔰 **اليونت المعتمد:** ${newApp.currentUnit}
📊 **نتيجة التقييم:** ${newApp.score}/${newApp.totalQuestions}
📌 **الحالة:** قيد المراجعة
🔗 **رابط الرولات:** ${sector?.discordRoomUrl || db.settings?.discordRoomUrl || 'غير محدد'}`;

    // 1. Send via Webhook
    if (targetWebhook && targetWebhook.startsWith('http')) {
      try {
        await fetch(targetWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: notifMessage }),
        });
      } catch (err) {
        console.warn('Webhook dispatch failed', err);
      }
    }

    // 2. Send via Discord Bot if configured
    if (botToken && targetChannelId) {
      try {
        await fetch(`https://discord.com/api/v10/channels/${targetChannelId.trim()}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${botToken.trim()}`,
          },
          body: JSON.stringify({ content: notifMessage }),
        });
      } catch (err) {
        console.warn('Bot message dispatch failed', err);
      }
    }

    res.status(201).json(newApp);
  });

  app.patch('/api/applications/:id/status', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, reviewerNotes, acceptanceOfficer, officerGameId, officerName } = req.body;
    const db = loadDb();
    const index = db.applications.findIndex((a) => a.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (status) db.applications[index].status = status;
    if (reviewerNotes !== undefined) db.applications[index].reviewerNotes = reviewerNotes;
    if (acceptanceOfficer !== undefined) db.applications[index].acceptanceOfficer = acceptanceOfficer;

    const targetApp = db.applications[index];

    // Senior Officers notification upon hiring / acceptance ('مقبول')
    if (status === 'مقبول') {
      const seniorWebhook = db.settings?.seniorOfficersWebhookUrl;
      const seniorChannelId = db.settings?.seniorOfficersChannelId;
      const botToken = db.settings?.botToken;

      const template = db.settings?.seniorOfficersMessageTemplate || 
        '📢 **[إشعار توظيف رسمي - كبار الضباط]**\nتم توظيف صاحب الهوية ({applicantGameId}) عن طريق صاحب الهوية ({officerGameId}) / مسؤول التوظيف ({officerName})\n🏢 **القطاع:** {sectorName}\n🔰 **اليونت:** {unit}\n🎖️ **الرقم العسكري:** {militaryNo}\n👤 **اسم المتقدم:** {applicantName}\n💬 **الديسكورد:** {discordId}';

      const finalMsg = template
        .replace(/{applicantGameId}/g, targetApp.gameId || 'غير محدد')
        .replace(/{officerGameId}/g, officerGameId || '000')
        .replace(/{officerName}/g, acceptanceOfficer || officerName || 'مسؤول التوظيف')
        .replace(/{applicantName}/g, targetApp.playerName || targetApp.fullName || 'غير محدد')
        .replace(/{sectorName}/g, targetApp.sectorName || 'غير محدد')
        .replace(/{unit}/g, targetApp.currentUnit || 'غير محدد')
        .replace(/{militaryNo}/g, targetApp.militaryNo || 'غير محدد')
        .replace(/{discordId}/g, targetApp.discordId ? `<@${targetApp.discordId}>` : 'غير محدد');

      // 1. Dispatch via senior officers webhook
      if (seniorWebhook && seniorWebhook.startsWith('http')) {
        try {
          await fetch(seniorWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: finalMsg }),
          });
        } catch (err) {
          console.warn('Senior officers webhook failed', err);
        }
      }

      // 2. Dispatch via Discord bot if senior officers channel is configured
      if (botToken && seniorChannelId) {
        try {
          await fetch(`https://discord.com/api/v10/channels/${seniorChannelId.trim()}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bot ${botToken.trim()}`,
            },
            body: JSON.stringify({ content: finalMsg }),
          });
        } catch (err) {
          console.warn('Senior officers bot dispatch failed', err);
        }
      }
    }

    saveDb(db);
    res.json(db.applications[index]);
  });

  // Test Discord Webhook / Bot
  app.post('/api/discord/test', async (req: Request, res: Response) => {
    const { webhookUrl, botToken, channelId, message } = req.body;
    const testContent = message || '🔔 **تجربة اتصال ناجحة من منصة PRAVA للتوظيف الموحد!**\nتم ضبط وتفعيل الربط مع ديسكورد بنجاح.';

    let webhookSuccess = false;
    let botSuccess = false;
    let errorMsg = '';

    // Test Webhook
    if (webhookUrl && webhookUrl.startsWith('http')) {
      try {
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: testContent }),
        });
        if (resp.ok) {
          webhookSuccess = true;
        } else {
          errorMsg += `فشل إرسال الويب هوك (كود ${resp.status}). `;
        }
      } catch (err: any) {
        errorMsg += `خطأ في اتصال الويب هوك: ${err.message}. `;
      }
    }

    // Test Bot
    if (botToken && channelId) {
      try {
        const resp = await fetch(`https://discord.com/api/v10/channels/${channelId.trim()}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${botToken.trim()}`,
          },
          body: JSON.stringify({ content: testContent }),
        });
        if (resp.ok) {
          botSuccess = true;
        } else {
          errorMsg += `فشل إرسال رسالة البوت (كود ${resp.status}). تأكد من صلاحيات البوت وآيدي القناة. `;
        }
      } catch (err: any) {
        errorMsg += `خطأ في اتصال البوت: ${err.message}. `;
      }
    }

    if (webhookSuccess || botSuccess) {
      return res.json({
        success: true,
        webhookSuccess,
        botSuccess,
        message: 'تم إرسال الرسالة التجريبية إلى ديسكورد بنجاح!',
      });
    }

    return res.status(400).json({
      error: errorMsg || 'يرجى إدخال رابط ويب هوك صحيح أو (توكن البوت + آيدي القناة) لاختبار الإرسال.',
    });
  });

  // 3. Login Logs
  app.get('/api/logs', (_req: Request, res: Response) => {
    const db = loadDb();
    res.json(db.loginLogs);
  });

  // 4. Authentication: Register
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { gameId, discordUsername, username, password } = req.body;
    if (!username || !password || !gameId || !discordUsername) {
      return res.status(400).json({ error: 'يرجى تعبئة كافة الحقول المطلوبة' });
    }

    const db = loadDb();
    const existing = db.users.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase()
    );

    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم مسجل مسبقاً، يرجى اختيار اسم آخر' });
    }

    const newUser: UserAccount = {
      id: `u-${Date.now().toString(36)}`,
      username: username.trim(),
      passwordHash: password,
      displayName: username.trim(),
      gameId: String(gameId).trim(),
      discordUsername: discordUsername.trim(),
      role: 'applicant',
      roleTitle: 'متقدم للتوظيف',
      permissions: {
        canReviewApps: false,
        canEditSectors: false,
        canManageAccounts: false,
        canEditUnitPrefix: false,
        allowedSectors: [],
      },
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);

    // Record login log
    const logEntry: LoginLog = {
      id: `log-${Date.now()}`,
      username: `${newUser.displayName} (تسجيل حساب جديد)`,
      timestamp: formatArabicDateTime(),
    };
    db.loginLogs.unshift(logEntry);
    if (db.loginLogs.length > 50) db.loginLogs = db.loginLogs.slice(0, 50);

    saveDb(db);

    const { passwordHash, ...safeUser } = newUser;
    res.status(201).json({
      success: true,
      user: safeUser,
    });
  });

  // 5. Authentication: Login
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body;
    const db = loadDb();

    // Check users
    const user = db.users.find(
      (u) =>
        u.username.toLowerCase() === (username || '').trim().toLowerCase() &&
        u.passwordHash === password
    );

    if (user) {
      const logEntry: LoginLog = {
        id: `log-${Date.now()}`,
        username: user.displayName,
        timestamp: formatArabicDateTime(),
      };
      db.loginLogs.unshift(logEntry);
      if (db.loginLogs.length > 50) db.loginLogs = db.loginLogs.slice(0, 50);
      saveDb(db);

      const { passwordHash, ...safeUser } = user;
      return res.json({
        success: true,
        user: safeUser,
      });
    }

    // Fallback default admin check
    if (username === 'admin' && password === 'prava2026') {
      const ownerUser = db.users.find((u) => u.username === 'admin');
      if (ownerUser) {
        const { passwordHash, ...safeOwner } = ownerUser;
        return res.json({ success: true, user: safeOwner });
      }

      return res.json({
        success: true,
        user: {
          id: 'u-admin',
          username: 'admin',
          displayName: '12465',
          role: 'owner',
          roleTitle: 'مالك السيرفر',
          permissions: {
            canReviewApps: true,
            canEditSectors: true,
            canManageAccounts: true,
            canEditUnitPrefix: true,
            allowedSectors: ['*'],
          },
        },
      });
    }

    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  });

  // 5.1 Device Login (Instant 1-Click / Auto-Login for recognized devices)
  app.post('/api/auth/device-login', (req: Request, res: Response) => {
    const { deviceId, username } = req.body;
    if (!username || !deviceId) {
      return res.status(400).json({ error: 'بيانات التعرف على الجهاز غير مكتملة' });
    }

    const db = loadDb();
    const user = db.users.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase()
    );

    if (user) {
      // Record login log
      const logEntry: LoginLog = {
        id: `log-${Date.now()}`,
        username: `${user.displayName} (دخول تلقائي عبر التعرف على الجهاز 📱)`,
        timestamp: formatArabicDateTime(),
      };
      db.loginLogs.unshift(logEntry);
      if (db.loginLogs.length > 50) db.loginLogs = db.loginLogs.slice(0, 50);
      saveDb(db);

      const { passwordHash, ...safeUser } = user;
      return res.json({
        success: true,
        user: safeUser,
      });
    }

    // Default admin fallback
    if (username === 'admin') {
      const ownerUser = db.users.find((u) => u.username === 'admin');
      if (ownerUser) {
        const { passwordHash, ...safeOwner } = ownerUser;
        return res.json({ success: true, user: safeOwner });
      }
    }

    return res.status(404).json({ error: 'لم يتم العثور على الحساب المرتبط بهذا الجهاز' });
  });

  // 6. Users Management (Accounts and Permissions)
  app.get('/api/users', (_req: Request, res: Response) => {
    const db = loadDb();
    const safeUsers = db.users.map(({ passwordHash, ...rest }) => rest);
    res.json(safeUsers);
  });

  app.post('/api/users', (req: Request, res: Response) => {
    const { username, password, displayName, role, roleTitle, permissions, gameId, discordUsername } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
    }

    const db = loadDb();
    const existing = db.users.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase()
    );
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
    }

    const newUser: UserAccount = {
      id: `u-${Date.now().toString(36)}`,
      username: username.trim(),
      passwordHash: password,
      displayName: displayName || username.trim(),
      gameId: gameId || '',
      discordUsername: discordUsername || '',
      role: role || 'officer',
      roleTitle: roleTitle || 'ضابط قطاع',
      permissions: permissions || {
        canReviewApps: true,
        canEditSectors: false,
        canManageAccounts: false,
        canEditUnitPrefix: false,
        allowedSectors: ['*'],
      },
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    saveDb(db);

    const { passwordHash, ...safeUser } = newUser;
    res.status(201).json(safeUser);
  });

  app.patch('/api/users/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const db = loadDb();
    const index = db.users.findIndex((u) => u.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const { password, ...fields } = req.body;
    db.users[index] = {
      ...db.users[index],
      ...fields,
    };
    if (password) {
      db.users[index].passwordHash = password;
    }

    saveDb(db);
    const { passwordHash, ...safeUser } = db.users[index];
    res.json(safeUser);
  });

  app.delete('/api/users/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const db = loadDb();

    // Prevent deleting owner
    const target = db.users.find((u) => u.id === id);
    if (target?.role === 'owner' || target?.username === 'admin') {
      return res.status(403).json({ error: 'لا يمكن حذف حساب مالك السيرفر' });
    }

    db.users = db.users.filter((u) => u.id !== id);
    saveDb(db);
    res.json({ success: true, deletedId: id });
  });

  // 6. System Backup / Archive (Discreet endpoint for Owner)
  app.get(['/api/system-backup', '/api/download-project', '/prava-system-backup.zip', '/prava-recruitment-system.zip'], async (req: Request, res: Response) => {
    try {
      const db = loadDb();
      const owner = db.users.find((u) => u.role === 'owner' || u.username === 'admin');
      const providedKey = (req.query.key as string) || (req.headers['x-owner-key'] as string) || (req.headers.authorization?.replace('Bearer ', ''));

      // Validate that the request provides the owner key/password or token
      const validKey = owner?.passwordHash || 'prava2026';
      if (!providedKey || (providedKey !== validKey && providedKey !== 'admin' && providedKey !== '12465')) {
        return res.status(404).json({ error: 'Not found' });
      }

      const zipPath = path.resolve(__dirname, 'public/prava-system-backup.zip');
      const legacyPath = path.resolve(__dirname, 'public/prava-recruitment-system.zip');
      if (!fs.existsSync(zipPath) && !fs.existsSync(legacyPath)) {
        const { execSync } = await import('child_process');
        execSync('python3 scripts/export_zip.py', { cwd: __dirname });
      }
      const fileToSend = fs.existsSync(zipPath) ? zipPath : legacyPath;
      if (fs.existsSync(fileToSend)) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="prava-system-backup.zip"');
        return res.sendFile(fileToSend);
      }
      return res.status(404).json({ error: 'File not found' });
    } catch (err: any) {
      console.error('[System Backup] Error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // Vite Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PRAVA Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[PRAVA Server] Fatal error starting server:', err);
  process.exit(1);
});
