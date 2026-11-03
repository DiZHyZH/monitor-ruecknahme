# Monitor-Rücknahme

Entwickelt von Marco van der Ploeg (dplan IT Services).

Web-App für Geräte-Rücknahmen und Rollouts: Der Dispatcher eröffnet Aufträge mit allen Pflichtangaben (Kunde, Datum, Standorte, Ansprechperson, Soll-Mengen, Material), der Lead lädt sein Team per QR-Code ein, alle erfassen Asset-IDs per Handscanner, Kamera oder Galerie inklusive Materialverbrauch. Export als Excel (Geräte, Soll-Ist, Material). Läuft offline mit automatischer Synchronisation.

- App: `index.html`, `app.js`, `app.css`, Bibliotheken in `vendor/`
- Datenbank (Supabase): `supabase-setup.sql`, danach `supabase-fix-1.sql`, `supabase-fix-2-logins.sql`, `supabase-fix-3-auftraege.sql`
- Anleitung: `anleitung.html`, Installation: `installieren.html`
