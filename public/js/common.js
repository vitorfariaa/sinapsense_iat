// public/js/common.js
'use strict';

async function getJSON (url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('erro ao buscar ' + url);
  return r.json();
}

async function postJSON (url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error('erro ao enviar ' + url);
  return r.json();
}

function qs (sel, el) { return (el || document).querySelector(sel); }
function qsa (sel, el) { return Array.from((el || document).querySelectorAll(sel)); }

function shuffle (arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function param (key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}
