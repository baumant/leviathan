import './style.css';

import { Game } from './game/Game';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app mount point');
}

const SEO_TITLE = 'LEVIATHAN';
const SEO_DESCRIPTION = "Towards thee I roll, thou all-destroying but unconquering whale; to the last I grapple with thee; from hell's heart I stab at thee; for hate's sake I spit my last breath at thee.";
const COVER_ALT =
  'Woodcut-style cover art showing a colossal whale tearing through a whaling ship and scattered sailors at sea.';

syncMetadata();

new Game(app);

function syncMetadata(): void {
  const pageUrl = new URL(window.location.pathname, window.location.origin).toString();
  const coverImageUrl = new URL('/cover-image.png', window.location.origin).toString();

  document.title = SEO_TITLE;

  setMetaTag('name', 'description', SEO_DESCRIPTION);
  setMetaTag('name', 'theme-color', '#010306');
  setMetaTag('property', 'og:type', 'website');
  setMetaTag('property', 'og:title', SEO_TITLE);
  setMetaTag('property', 'og:description', SEO_DESCRIPTION);
  setMetaTag('property', 'og:image', coverImageUrl);
  setMetaTag('property', 'og:image:alt', COVER_ALT);
  setMetaTag('property', 'og:url', pageUrl);
  setMetaTag('name', 'twitter:card', 'summary_large_image');
  setMetaTag('name', 'twitter:title', SEO_TITLE);
  setMetaTag('name', 'twitter:description', SEO_DESCRIPTION);
  setMetaTag('name', 'twitter:image', coverImageUrl);
  setMetaTag('name', 'twitter:image:alt', COVER_ALT);
}

function setMetaTag(attribute: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);

  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.append(tag);
  }

  tag.content = content;
}
