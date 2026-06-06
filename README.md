# TivyX — Streaming Africain Premium

Plateforme de streaming PWA des séries Highfields Originals.

## Stack
- Frontend : HTML/CSS/JS vanilla (PWA)
- Auth & DB : Supabase
- Paiements : GeniusPay
- Hébergement : Vercel

## Déploiement

Connecté à Vercel via GitHub — chaque push sur `main` déclenche un déploiement automatique.

## Structure
```
/
├── index.html      ← App principale
├── sw.js           ← Service Worker PWA
├── manifest.json   ← Manifest PWA
├── offline.html    ← Page hors ligne
├── icons/          ← Icônes PWA (72→512px)
└── vercel.json     ← Config déploiement
```
