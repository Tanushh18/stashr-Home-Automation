const User = require("../models/schema");
const T = require("./telegramText");
const esc = T.esc;
const dateText = value => { if(!value)return "unknown"; const d=new Date(value); return Number.isNaN(d.getTime())?"unknown":d.toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}); };
const countLine = (label,value) => "• "+label+": <b>"+Number(value||0)+"</b>";
async function safeEntries(user,field) {
  const key=await user.getDataKey();
  return (user[field]||[]).map(e=>e?.enc==="udk"?User.publicEntry(e,key):e).filter(e=>e&&!e.broken&&e.enc!=="e2e");
}
async function runTelegramRead(user,cmd,args=[]) {
  const owner=user._id;
  switch(cmd) {
    case "overview": return ["<b>Stashr overview</b>",countLine("Projects",(await safeEntries(user,"projects")).length),countLine("Vault entries",(user.passwords||[]).length),countLine("Render accounts",(await safeEntries(user,"renderAccounts")).length),countLine("GitHub accounts",(await safeEntries(user,"githubAccounts")).length),countLine("Hosting accounts",(await safeEntries(user,"hostAccounts")).length),"API uptime: "+Math.floor(process.uptime()/60)+" min"].join("\n");
    case "health": return "<b>API health</b>\nProcess: 🟢 running\nDatabase: "+(require("mongoose").connection.readyState===1?"🟢 connected":"🔴 unavailable")+"\nNode: "+esc(process.version);
    case "uptime": {const n=Math.floor(process.uptime());return "<b>API uptime</b>\n"+Math.floor(n/86400)+"d "+Math.floor(n%86400/3600)+"h "+Math.floor(n%3600/60)+"m";}
    case "scheduler": case "jobs": {
      const data=await require("./scheduler").getSchedulerStatus(cmd==="jobs"?10:3),runs=data.recentRuns||[];
      if(!runs.length)return "No persisted scheduler run is available yet.";
      return "<b>"+(cmd==="jobs"?"Recent background jobs":"Scheduler")+"</b>\n"+runs.map(r=>(r.status==="success"?"🟢":"🟠")+" "+esc(r.status)+" · "+dateText(r.completedAt)+" · "+Number(r.durationMs||0)+" ms"+((r.steps||[]).some(s=>s.status!=="success")?"\n  Issues: "+esc(r.steps.filter(s=>s.status!=="success").map(s=>s.name+" ("+s.status+")").join(", ")):"")).join("\n");
    }
    case "vault": {const p=user.passwords||[],current=p.filter(e=>e.enc==="udk").length;return "<b>Vault inventory</b>\n"+countLine("Total entries",p.length)+countLine("Current encrypted entries",current)+countLine("Legacy / device-encrypted entries",p.length-current)+"\nNo passwords or vault plaintext are shown. Use /pass name with your Telegram PIN for one login.";}
    case "security": {const state=await require("./telegramBot").readState(user);return "<b>Account security</b>\n2FA: "+(user.twoFactor?.enabled?"🟢 enabled":"⚪ disabled")+"\nRecovery codes remaining: "+(user.twoFactor?.enabled?(user.twoFactor.recoveryCodes||[]).length:0)+"\nActive sessions: "+(user.tokens||[]).length+"\nTelegram password lookup: "+(state?.passwordsAllowed?"enabled":"disabled");}
    case "sessions": {const a=(user.tokens||[]).slice().sort((x,y)=>Date.parse(y.createdAt||0)-Date.parse(x.createdAt||0)).slice(0,10);return a.length?"<b>Recent active sessions</b>\n"+a.map(s=>"• "+esc(s.device||s.client||"Device")+" · "+esc(dateText(s.createdAt))).join("\n")+"\nSession tokens are never displayed.":"No active sessions.";}
    case "audit": {const Audit=require("../models/AuditEvent"),rows=await Audit.find({userId:owner}).sort({at:-1}).limit(12).lean();return rows.length?"<b>Recent account activity</b>\n"+rows.map(e=>"• "+esc(e.action)+" · "+esc(dateText(e.at))+(e.device?" · "+esc(e.device):"")).join("\n"):"No recent security audit events.";}
    case "expenses": case "spending": case "expensemonth": {const Expense=require("../models/expenseTx"),month=new Date().toISOString().slice(0,7),rows=await Expense.find({owner,...((cmd==="spending"||cmd==="expensemonth")?{month}:{})}).select("month date status").lean(),counts=rows.reduce((o,r)=>(o[r.status||"Unverified"]=(o[r.status||"Unverified"]||0)+1,o),{});return "<b>Money / Expenses</b>\nDatabase transaction records: "+rows.length+(cmd==="spending"?" · current month "+esc(month):"")+(Object.keys(counts).length?"\n"+Object.entries(counts).map(([k,v])=>esc(k)+": "+v).join(" · "):"")+"\nAmounts and merchants are encrypted; this bot shows counts only. Google-Sheet-only storage is not read by this command.";}
    case "github": case "hosts": {const field=cmd==="github"?"githubAccounts":"hostAccounts",a=await safeEntries(user,field);return a.length?"<b>"+(cmd==="github"?"GitHub":"Hosting")+" accounts</b>\n"+a.map(x=>"• "+esc(x.name||x.username||x.login||x.provider||"Connected account")+(x.provider?" · "+esc(x.provider):"")).join("\n")+"\nCredentials are never displayed.":"No "+(cmd==="github"?"GitHub":"hosting")+" accounts are connected.";}
    case "registry": case "serverurls": {const Registry=require("../models/registry"),rows=await Registry.find({$or:[{owner},{owner:null},{owner:{$exists:false}}]}).sort({app:1}).limit(60).lean();return rows.length?"<b>App server registry</b>\n"+rows.map(r=>"• <b>"+esc(r.app)+"</b> — "+(r.off||!r.urls?.length?"off":r.urls.map(u=>esc(String(u).replace(/^https?:\/\//,""))).join(", "))+(r.autoSync?" · auto-sync":"")).join("\n"):"No app server registry entries found.";}
    case "statuspage": {const p=user.publicStatus||{};return "<b>Public status page</b>\n"+(p.enabled?"🟢 Enabled":"⚪ Disabled")+(p.title?"\nTitle: "+esc(p.title):"")+(p.slug?"\nURL: /status/"+esc(p.slug):"")+"\nMonitored services: "+(p.serviceIds||[]).length;}
    case "automations": case "scenes": case "schedules": case "places": {const S=require("../models/homeSettings"),s=await S.findOne({owner}).lean();if(!s)return "No Smart Home settings found.";if(cmd==="scenes")return (s.scenes||[]).length?"<b>Home scenes</b>\n"+s.scenes.map(x=>"• "+esc(x.name||x.label||x.id||"Unnamed scene")).join("\n"):"No home scenes configured.";if(cmd==="schedules")return (s.schedules||[]).length?"<b>TV schedules</b>\n"+s.schedules.map(x=>"• "+esc(x.name||x.label||x.time||"Schedule")+(x.enabled===false?" · disabled":" · enabled")).join("\n"):"No TV schedules configured.";if(cmd==="places")return (s.places||[]).length?"<b>Family places</b>\n"+s.places.map(x=>"• "+esc(x.name||"Unnamed place")+(x.enabled===false?" · disabled":"")).join("\n"):"No family places configured.";return "<b>Smart Home automations</b>\nScenes: "+(s.scenes||[]).length+"\nTV schedules: "+(s.schedules||[]).length+"\nPlaces: "+(s.places||[]).length+"\nTV limit: "+Number(s.tvLimit?.minutes||0)+" minutes/day";}
    case "services": case "metrics": {const ops=require("./renderOps"),key=await user.getDataKey();if(cmd==="services"){const d=await ops.listEveryService(user,key);return d.services.length?"<b>Render services</b> ("+d.services.length+")\n"+d.services.slice(0,40).map(s=>(s.suspended?"⏸":"🟢")+" "+esc(s.name)+(s.type?" · "+esc(s.type):"")).join("\n"):"No Render services are connected.";}const h=ops.encryptedList(user,"renderMetricHistory",key,10).sort((a,b)=>Date.parse(b.sampledAt||0)-Date.parse(a.sampledAt||0)),last=h[0];return last?"<b>Latest monitoring snapshot</b>\nSampled: "+esc(dateText(last.sampledAt))+"\nServices sampled: "+((last.services||[]).length)+"\nHistorical snapshots: "+h.length:"No Render monitoring snapshots have been recorded yet.";}
    case "deploys":
    case "projectdeploy": {
      const projects = await safeEntries(user, "projects");
      const chosen = args[0] ? projects.filter(p => String(p._id) === String(args[0]) || String(p.name || "").toLowerCase().includes(args.join(" ").toLowerCase())) : projects;
      if (args.length && !chosen.length) return "No project matches that ID or name.";
      const ops = require("./deployOps"), lines = ["<b>Recent deployments</b>"];
      for (const p of chosen.slice(0, 10)) {
        const targets = await ops.listTargets(user, String(p._id));
        for (const t of targets) {
          const d = t.latestDeploy;
          if (d) lines.push((/live|ready|success/i.test(d.status) ? "🟢" : /fail|error/i.test(d.status) ? "🔴" : "🟡") + " <b>" + esc(p.name || "Project") + "</b> · " + esc(t.name) + " — " + esc(d.status) + (d.at ? " · " + esc(dateText(d.at)) : "") + (d.commit ? "\\n  " + esc(d.commit) : ""));
          else if (t.error) lines.push("⚪ " + esc(p.name || "Project") + " · " + esc(t.name) + " — " + esc(t.error));
        }
      }
      return lines.length > 1 ? lines.join("\\n") : "No deployment records are available for these projects.";
    }
    case "logs": {
      const projectId = String(args[0] || ""), ref = String(args[1] || "");
      if (!/^[a-f0-9]{24}$/i.test(projectId) || !/^(render|host):[A-Za-z0-9_-]{1,160}$/.test(ref)) return "Usage: /logs <projectId> <render:serviceId or host:linkId>. Find project IDs with /projects.";
      const ops = require("./deployOps"), target = await ops.findTarget(user, projectId, ref), result = await ops.logsOf(target, "");
      if (!result.ok) return "Logs unavailable: " + esc(result.error);
      const lines = (result.lines || []).slice(-12).map(line => {
        const safe = String(line.text || "").replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]").replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]").slice(0, 300);
        return "• " + esc(safe);
      });
      return "<b>Recent logs · " + esc(target.name) + "</b>\\n" + (lines.length ? lines.join("\\n") : "No recent log lines.");
    }
    case "secretscan": {const r=await require("./secretExposureRunner").scanUser(user),lines=["<b>Environment exposure scan</b>","Services scanned: "+r.scanned+"/"+r.total,"Potential exposed variables: "+r.findings.length,"Stale backend URL references: "+r.staleAddresses.length];for(const f of r.findings.slice(0,8))lines.push("⚠️ "+esc(f.service)+" · "+esc(f.key)+" · "+esc(f.reason||"exposure risk"));for(const f of r.staleAddresses.slice(0,8))lines.push("🔗 "+esc(f.service)+" · "+esc(f.key)+" · stale address");if(!r.complete)lines.push("⚠️ Inventory incomplete; results are partial.");return lines.join("\n");}
    case "extension": return "<b>Browser extension</b>\nPassword lookup endpoints exist. The backend does not record an extension heartbeat or installed version, so Telegram cannot truthfully report whether a browser extension is online.";
    case "apps": case "ota": return "<b>Stashr app update endpoints</b>\nMain Android: /api/mobile-updates/android/latest\nHub: /api/mobile-updates/hub/latest\nTV: /api/mobile-updates/tv/latest\nCast: /api/mobile-updates/cast/latest\nLocation: /api/mobile-updates/where/latest\nStashr OTA manifest: /api/ota/manifest\nA published release does not prove that a device installed it.";
    case "shine": {const Shine=require("../models/shineSite"),d=await Shine.findById("shine").lean(),p=d?.projects||[];return p.length?"<b>Shine website projects</b>\n"+p.slice(0,20).map(x=>"• "+esc(x.name||x.key)+" — "+esc(x.stage||"status not set")+(x.progress!=null?" · "+Number(x.progress)+"%":"")).join("\n"):"No Shine website project status records found.";}
    default: return null;
  }
}
module.exports = { runTelegramRead, safeEntries, dateText };
