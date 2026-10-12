# Sample Rectification Protocol (SRP)

Every sample/placeholder value on the website is listed here.
When the owner says **"SRP"**, go through this list, ask for each real value, and replace it.

## Company details
- [ ] **Office location / address**: sample: `City, State, India`
  - `index.html`: enquiry section (Office) and footer (Contact)
- [ ] **Phone number**: sample: `+91 90000 00000`
  - `index.html`: enquiry section (Call us), footer (`tel:` links)
- [ ] **WhatsApp number**: sample: `919000000000`
  - `assets/js/main.js`: `CONFIG.whatsapp` (used by floating button, contact card and form)
  - `index.html`: fallback `href="https://wa.me/..."` on `data-wa` links
- [ ] **Email address**: sample: `info@faunira.com`
  - `assets/js/main.js`: `CONFIG.email` (used by the form's "Send via Email")
  - `index.html`: enquiry section and footer (`mailto:` links)

## Home page numbers (stats band)
- [ ] Formulations count: sample `25+`
- [ ] Farms & clinics served: sample `500+`
- [ ] Districts reached: sample `10+`
- [x] Founded: `2023` (confirmed)

## Products
- [ ] **Product categories**: sample list: Antibacterials, Vitamins & Minerals, Immunity Boosters,
      Liver & Kidney Tonics, Feed Supplements, Dewormers
  - `index.html`: "Product categories" section and the form's "Interested in" dropdown
- [ ] **Featured products** (names, type, description): sample "Product Name One" to "Four"
- [ ] **Product images**: sample SVG mock-ups in `assets/img/products/`
  - Owner will provide the product catalogue

## Enquiry form
- [ ] Where should submissions go? Currently opens **WhatsApp** or the **email app** with the
      details pre-filled (no server needed). Option: a form service such as Formspree.

## Claims to confirm
- [ ] Hero trust points: "Quality-tested batches", "Vet-trusted formulations", "Easy ordering"
- [ ] Any certifications (GMP / ISO / etc.) to display
