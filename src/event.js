// Tekst i podaci o događaju koji se prikazuju na pozivnici.
// Promijenite ovdje datum, vrijeme ili mjesto - sve stranice i izvozi čitaju odavde.
export const EVENT = {
  edition: '31.',
  name: 'Zlatna kuna',
  title: '31. Zlatna kuna',
  titleAccusative: '31. Zlatnu kunu', // "dolazak na 31. Zlatnu kunu"
  qrPrefix: 'ZK31',
  greeting: 'Poštovani,',
  // Dijelovi u **zvjezdicama** prikazuju se podebljano (zlatno).
  intro:
    'osobita mi je čast pozvati Vas na 31. svečanu dodjelu nagrada Hrvatske gospodarske komore ' +
    '„Zlatna kuna” koja će se održati u **srijedu, 7. listopada 2026. godine u 20:10 sati** u ' +
    '**Hrvatskom narodnom kazalištu u Zagrebu**, Trg Republike Hrvatske 15, uz izravan televizijski prijenos.',
  closing: 'Radujem se Vašem dolasku!',
  signatureName: 'dr. sc. Luka Burilović',
  signatureTitle: 'predsjednik',
  notes: [
    'Ulaznice se mogu podići na blagajni Hrvatskog narodnog kazališta u Zagrebu u utorak, 6. listopada 2026. ' +
      'od 10:00 do 16:00 sati i u srijedu, 7. listopada 2026. od 10:00 do 14:00 sati.',
    'S obzirom na izravan televizijski prijenos na mjesto održavanja trebalo bi doći 30 minuta prije početka programa.',
    'Pozivnica nije prenosiva.',
    'Stil odijevanja: tamno odijelo/koktel haljina.',
  ],
  // Kada gosti dobivaju e-kartu (QR kod + sjedeće mjesto) - piše u e-mailu potvrde i na stranici pozivnice.
  ticketWhen: 'dan prije Zlatne kune, u utorak, 6. listopada 2026.',
  contactEmail: 'zlatnakuna@hgk.hr',
  regards: 'S poštovanjem,',
  organizer: 'Hrvatska gospodarska komora',
};
