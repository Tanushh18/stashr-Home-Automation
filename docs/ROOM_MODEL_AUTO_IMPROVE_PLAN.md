# 3D model fixes + Room model auto-improve: poora plan (aur kyun)

> **Branch:** `3d-model-fixes` · **Status:** is document ka har point (Part A–E) is branch mein bana aur test hua hai. Jo **nahi** banaya, wo
> Part F mein wajah ke saath likha hai. Kaam kaise karta hai, step by step: `docs/ROOM_LOCATION_HOW_IT_WORKS.md`.

Teen maange gaye kaam:
1. **3D model mein devices ka view behtar karo.**
2. **Kamra (room) delete karne ka option.**
3. **Stashr Location mein auto-improve:** phones khud-ba-khud room model ko behtar karte rahein, aur model zyada sahi (accurate) bane.

Neeche har kaam: abhi kya galat hai (code padh ke mila), kya badla, aur **kyun** (justification).

---

## 0. Abhi ki haalat (code se mila, andaza nahi)

| Jagah | Kya mila | Asar |
|---|---|---|
| `client/src/Pages/SmartHome/HouseModelView.jsx` | Sirf **log** dikhte the (label). Tablet ke Wi-Fi devices (TV, speaker…) jo kamron mein label kiye hain, aur tablet khud, 3D model mein **dikhte hi nahi** the (props mein bheje hi nahi jaate the). | "Devices ka view" 3D mein khaali tha. |
| same | three.js model ke hisson ke naam badal deta hai: Blender ka `Bedroom.001` → `Bedroom001`, `Bedroom 2` → `Bedroom_2`. Matching `o.name` (badla hua naam) se hoti thi. | Import ke waqt toast kehta "mil gaya", par 3D view mein Blender ke copy wale hisse **jagte nahi** the. **Bug.** |
| same | `paint()` pehli render ke `rooms` ko pakad ke rakhta tha (stale closure): model load hone tak log badal gaye to purane log dikhte. | Galat log dikh sakte the. **Bug.** |
| same | Labels ke textures / cloned materials kabhi `dispose` nahi hote the. | Har 30 s ke refresh par GPU memory badhti thi. **Leak.** |
| same | Koi click/tap nahi, reset view nahi, upar se view nahi, andar ke markers deewaron ke peeche chhup jaate. | Dekhna mushkil. |
| `HouseMap.jsx` | "3D model" button **sirf .glb import ke baad**. | Bina Blender ke 3D model view hi nahi. |
| Room delete | Web par: `<details>` ke andar chip ka ✕, phir alag se "Save rooms" (do kadam, chhupa hua). 3D/map mein koi delete nahi. **Stashr Location (phone) mein delete hai hi nahi.** Server: kamra hatane par phones ka `status.room` (abhi wala kamra) wahi rehta tha. | Hata hua kamra map par "abhi yahan" dikh sakta tha. |
| Room model (`server/utils/roomModel.js`) | Seekhna sirf haath se: "Main yahan hoon" aur "Galat hai". Samples 30 din mein aadhe asar ke ho jaate, 120 din mein mit jaate. | Model **samay ke saath kamzor** hota hai jab tak koi dobara train na kare. |
| same | Distance mein jo Bluetooth device ek scan mein ho, doosre mein na ho, use -100 maana jaata. Training Bluetooth ke saath, live scan bina Bluetooth (ya ulta) → **har** sample door lagta → "pakka nahi". | Bluetooth switch badalte hi model bigad jaata. **Bug.** |
| same | Router badla / padosi ka Wi-Fi gaya → purane samples mein wo network hamesha "missing" ki tarah fark daalta. | Galat doori, kam accuracy. |
| same | Chaudai (kernel width) sab gharon / phones ke liye fixed 5 dBm. | Har ghar alag hai; ek number sab par best nahi. |
| `/home/agent/room/confirm` ("Sahi hai") | Sirf ek ginti badhti thi; scan nahi jaata tha. | Sabse saste aur sahi label (insaan ne khud kaha "sahi hai") **bekaar** jaate the. |

---

## Part A — 3D model: devices ka view

**A1. 3D model hamesha milta hai.** Kamre bane hain to "3D model" button dikhta hai. Import kiya `.glb` ho to wahi, warna aapke layout se
`buildGlb()` se turant banta hai (har kamra ek dibba, layout ki unchai ke saath).
*Kyun:* devices/log 3D mein dekhne ke liye Blender ki zarurat nahi honi chahiye; layout pehle se hai.

**A2. Har kamre mein markers:**
- **Log:** ek pin + naam. Kamra pakka nahi (model "?") to pin dhundhla aur naam ke saath `?`.
- **Devices (tablet ke Wi-Fi par label kiye):** chhota dibba; hara = abhi Wi-Fi par, grey = kuch der se nahi dikha.
- **Tablet:** alag rang ka marker.
Markers kamre ke farsh par grid mein lagte hain (`spots()` pure function, test hua), taaki ek doosre par na chadhein.
*Kyun:* "kaun-sa device kis kamre mein, chal raha hai ya nahi" ek nazar mein.

**A3. Har kamre ka naam label** (sirf jahan log hain wahan nahi): `Bedroom · 2 device · Papa`.

**A4. Kamre par click/tap → panel:** kamre ka naam, kaun andar hai (aur kitna pakka), devices ki list (on/off), us kamre ki training (sab phones
ke scan), aur **"Kamra delete karo"** (Part B). Chuna hua kamra neela outline/rang leta hai.

**A5. Dekhne ke controls:** *Reset view*, *Upar se* (top view), *X-ray* (deewarein aadhi paardarshi, andar ke markers dikhte hain), damping
wala orbit, model ke size par camera fit, `ResizeObserver` se sahi size, legend.

**A6. Bugs fix:** (a) matching three.js ke badle naam ki jagah **asli glTF naam** (`userData.name`) se; (b) `paint()` hamesha **taaza** rooms
(ref se); (c) har repaint/unmount par textures, geometries aur cloned materials ka `dispose`; (d) asli material ka emissive yaad rakh ke
wapas lagana (tint permanent nahi).

---

## Part B — Kamra delete

**B1. Server: ek hi function `removeRoom()`** (`server/utils/roomLive.js`), do raaste:
- Website: `DELETE /home/room/:name`
- Phone (Stashr Location): `POST /home/agent/room/delete { name }`

Wo karta hai: room list se hatao, layout se hatao, **sab phones** ke us kamre ke samples mitao, jin phones ka abhi wala kamra yahi tha unka
`status.room` hatao, us kamre ke "kamron ke beech chalna" wale edges hatao, cache bhulao, timeline par ek line.
*Kyun:* pehle sirf list aur samples hatte the; phone ka "abhi Kitchen mein" reh jaata tha aur map par dikh sakta tha. Ab ek jagah, poora saaf.
`PUT /home/rooms` (purana bulk raasta) bhi ab yahi saaf-safai karta hai.

**B2. Website:** 3D panel mein delete; Room Lab mein har kamre ke chip ka ✕ ab **seedha delete** (confirm ke saath, kitne scan mitenge wo
batata hai). "Add" turant save. Alag "Save rooms" ki zarurat khatam.

**B3. Phone (Stashr Location → Room Lab):** naya card "Kamra hatao": har kamre ka button, confirm dialog ("sab phones ka training mitega").

**B4. Stashr app (Expo) Room Lab card:** wahi seedha delete.

---

## Part C — Room model: auto-improve aur zyada accuracy (server)

Seedhi baat: model ko **apne aap** naye, sahi label wale samples chahiye, bina galat label ke. Tareeka: **self-training (pseudo-labels)**, par
sakht shart aur suraksha ke saath, kyunki agar model apne galat jawab se seekhe to galti badhti jaati hai (confirmation bias). Isliye har
cheez ke saath ek "brake" hai.

**C1. Auto sample sirf tab (`autoGate`, pure, test hua):**
| Shart | Value | Kyun |
|---|---|---|
| Phone ka auto-improve on, aur ruka (paused) nahi | – | Opt-out har phone par. |
| Scan **taaza** (Wi-Fi nateeje ≤ 120 s purane) | `ageSec ≤ 120` | 10 min purana Wi-Fi nateeja doosre kamre ka ho sakta hai. Purane app version `ageSec` nahi bhejte → kabhi auto nahi. |
| Confidence | ≥ 75% | Sirf pakke jawab. |
| Pehle aur doosre kamre ka fark (margin) | ≥ 35 points | Do milte-julte kamron (Hall/Kitchen) mein auto label nahi. |
| Sabse paas ke sample ki doori | ≤ 12 dBm | Sirf jaani-pehchani jagah ko taaza karo; anjaan jagah par andaaza nahi. |
| Kamra **sthir** (pichhla smoothed kamra bhi yahi, aur abhi bhi yahi) | – | Kamra badalte waqt ke scan (darwaze par) label nahi bante. |
| Model paka hua: kam se kam 2 kamre ≥ 5 insaani samples, aur ye kamra bhi ≥ 5 | – | Kachche model ko khud par bharosa nahi karna chahiye. |
| Rate: ek kamre ka auto sample 10 min mein ek | – | Sofa par 3 ghante baithne se 1000 ek-jaise sample nahi. |
| Near-duplicate: 24 h ke andar ka auto sample < 3 dBm paas ho to nahi | – | Variety bani rahe. |

**C2. Wazan (source weight):** `fix` (galat-hai sudhaar) **1.5**, `train` 1, `confirm` (sahi-hai) 1, `auto` **0.5**. Kamre ka score ab
weighted average hai. *Kyun:* sudhaar wahi jagah hai jahan model galat tha (sabse keemti); auto label model ka apna hai, isliye aadha.

**C3. Alag hadein:** insaani samples 80 / kamra / phone (pehle jaisa), auto samples **alag se** 40. *Kyun:* auto samples insaani training
ko kabhi dhakka de ke bahar na karein.

**C4. "Galat hai" purane galat auto samples mitata hai:** sudhaar aane par us phone ke pichhle 24 ghante ke wo auto samples jo **doosre**
kamre ke naam se hain aur sudhaar wale scan ke paas (≤ 12 dBm) hain, mita diye jaate hain. *Kyun:* galat pseudo-label ko turant jad se hatao.

**C5. Imaandaar accuracy:** "chhupa ke guess" ab **sirf insaani samples** ko jaanchta hai (train/fix/confirm). Auto samples training mein
madad karte hain par kabhi "test" nahi bante. *Kyun:* model ke apne label se apni jaanch = khud ko number dena.

**C6. Guard (auto-rollback), har ghante:** ek hi test set par accuracy **auto samples ke saath** vs **bina**. Saath wali 3 points se zyada
kam → us phone ka auto-improve **7 din ruk jaata hai**, uske auto samples mitte hain, timeline par line. *Kyun:* agar kabhi auto-improve
nuksaan kare to wo khud pakda jaaye aur khud ulta ho, bina kisi ke dekhe.

**C7. Chaudai ka auto-tune, har ghante, har phone:** chaudai `[4, 5, 7, 9, 12]` dBm try karke wo chuno jiska score
`accuracy − 0.5 × galat%` sabse acha ho; default 5 sirf tab badlo jab naya **2+ points** behtar ho. *Kyun:* har ghar/phone ka shor alag;
"galat" ko "pakka nahi" se zyada saza, kyunki galat kamra bolna "pata nahi" se bura hai. Doori ek baar nikal ke (matrix) sab chaudai par
dobara use hoti hai, isliye sasta.

**C8. Modality-aware doori (bug fix):** Bluetooth sirf tab gina jaata hai jab **dono** scans mein Bluetooth ho (Wi-Fi ke liye bhi wahi).
*Kyun:* "Bluetooth band karke scan" ab "sab anjaan" nahi lagta.

**C9. Gaye hue networks (radio mahaul badla):** jo network/device 14+ din purane samples mein zor se (≥ −80 dBm) suna tha, par **har** us
kamre ke 7 din ke taaza samples (kam se kam 3, usi qism ke: Wi-Fi/Bluetooth) mein ek baar bhi nahi suna, wo doori mein **ignore**. Taaza
samples zyada-tar auto-improve se aate hain, isliye ye dono saath kaam karte hain. *Kyun:* router badla ya padosi ka Wi-Fi gaya to purane
samples ka "missing" fark har guess ko bigaadta tha. Jis kamre ka taaza data nahi, wahan kuch ignore nahi (us kamre ka beacon galti se na hate).

**C10. "Sahi hai" ab label hai:** phone 6 second sunke scan bhejta hai; server use `confirm` sample banata hai (aur ginti bhi). *Kyun:*
insaan ka "haan, yahi kamra" sabse sasta sahi label hai, aur bilkul wahi jagah jahan log asal mein rehte hain.

**C11. Kamron ke beech chalna → map apne aap behtar:** jab kisi ka kamra sach mein badalta hai (Bedroom → Kitchen), wo jodi gini jaati hai.
Jin kamron ka layout aapne save **nahi** kiya, auto-arrange unhe jodi ke hisaab se paas-paas rakhta hai. *Kyun:* "devices khud model behtar
karein" ka doosra hissa: ghar ka 2D/3D map bhi asli chalne ke data se sudharta hai. Aapka save kiya layout kabhi nahi badalta.

**C12. Accuracy girne ki chetavni:** har ghante ki jaanch mein agar accuracy apne best se 15+ points giri (aur 7 din mein pehli baar),
timeline par: "Papa ka room model kamzor hua (88% → 64%): Room Lab mein dobara train karo."

**C13. Sab dikhta hai:** live report (website + tablet, ek hi endpoint) mein har phone ka: auto on/off, kitne auto sample, aakhri kab aur kis
kamre ka, ruka hai to kab tak aur kyun, guard ke aankde (saath/bina), tuned chaudai. Website par har phone ka auto-improve switch.

---

## Part D — Stashr Location update (1.10.0)

**D1. Taaza scan:** room location + auto-improve on, aur phone Wi-Fi par → agar Android ka Wi-Fi nateeja 2 min se purana hai to naya scan
maango (`startScan`) aur 5 s tak ruko; har 10 min mein zyada se zyada ek baar. Android background mein ~30 min mein ek scan deta hai;
mana kare to purana nateeja jaata hai (pehchan hoti hai, auto label nahi). *Kyun:* auto label sirf taaza scan par (C1).

**D2. Scan ke saath `ageSec` aur `auto`** jaata hai. **D3.** Server ke har jawab ka `roomAuto` follow (website se switch badla to phone bhi).

**D4. Room Lab:** "Apne aap behtar ho (auto-improve)" switch + aankde ("Apne aap seekhe: 34 scan · aakhri: Bedroom, 12 min pehle", ya "ruka hua:
accuracy giri thi"); **"Sahi hai ✓" ab 6 s scan bhejta hai**; naya **"Kamra hatao"** card.

**D5.** Version `1.9.0 → 1.10.0`.

---

## Part E — Tests (sab chal ke pass)

- `server/tests/roomModel.test.js`: source weights, modality-aware doori, gone networks, autoGate ki har shart, human-only CV, tuning,
  wrong-auto purge.
- `server/tests/homeRoom.test.js`: web + phone delete (samples, layout, `status.room`, edges saaf), live scan se auto sample banna,
  rate-limit, purana app (bina `ageSec`) → koi auto nahi, "Galat hai" purge, guard pause, tuning save, "Sahi hai" scan, kamron ki jodi.
- `client/tests/houseGlb.test.mjs` + naya `houseScene.test.mjs`: asli glTF naam, marker spots, room summary.
- `client/tests/roomLab.test.mjs`: auto-improve ki lines.
- `where-app/.../RoomLogicTest.kt`: `ageSec`, auto text, scan JSON.

---

## Part F — Jo jaan-boojh ke **nahi** kiya (aur kyun)

- **"Kya aap Bedroom mein ho?" notification (active learning):** sabse taaqatwar agla kadam, par roz ke notification pareshan karte hain;
  kitni baar poochna hai ye aapka faisla hai. Abhi "Sahi hai/Galat hai" + auto-improve kaafi hai; data dekh ke tay karenge.
- **Aadat se andaza (raat ko bedroom):** hafton ka data chahiye, aur galat bias ka khatra. Pehle C6/C12 ke aankde dekho.
- **Tablet par local pehchan, magnetometer, beacons:** `docs/ROOM_LOCATION_PLAN.md` mein alag phases, is kaam ka hissa nahi.
- **3D model tablet par:** tablet ka map 2D hai; 3D sirf website par (pehle jaisa).

## Kaise napoge ki behtar hua
1. Website → Insights → ROOM MODEL: har phone ki "chhupa ke guess" accuracy aur "asli" (taps) accuracy.
2. Auto-improve ke aankde: auto samples badh rahe hain, guard "saath ≥ bina" dikha raha hai.
3. Hafte baad "asli accuracy" (Sahi hai / Galat hai) dekho: auto-improve se pehle aur baad. Yahi asli sach hai.
