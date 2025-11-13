// public/js/run.js
'use strict';

let state = {
  test: null,
  runId: null,
  seq: [],
  idx: 0,
  showingPrime: false,
  trialStartAt: 0
};

const PRACTICE = ['bom', 'ruim', 'gostoso'];
let practiceIdx = 0;
let practiceActive = false;

async function initRunPage () {
  const testId = Number(param('id'));
  if (!testId) { location.href = '/'; return; }
  qs('#backToTest').href = '/test?id=' + testId;

  const t = await getJSON('/api/tests/' + testId);
  state.test = t;

    // define modo
  const mode = (t.response_labels === 'sn') ? 'sn' : 'pn';
  const labelLeft  = (mode === 'sn') ? 'SIM'      : 'positivo';
  const labelRight = (mode === 'sn') ? 'NÃO'      : 'negativo';

  // aplica rótulos dinâmicos
  qs('#step2 p').innerHTML = `Quando aparecer uma palavra, aperte <kbd>E</kbd> se achar <strong>${labelLeft}</strong> ou <kbd>O</kbd> se achar <strong>${labelRight}</strong>.`;
  qsa('#step4 p.dim.center').forEach(p => p.innerHTML =
    `Responda com <kbd>E</kbd> (${labelLeft}) ou <kbd>O</kbd> (${labelRight})`
  );

  qs('#goStep2').addEventListener('click', async () => {
    const age = Number(qs('#age').value || 0);
    const gender = qs('#gender').value || '';

    const { runId } = await postJSON(`/api/tests/${testId}/runs`, { age, gender });
    state.runId = runId;

    qs('#step1').classList.add('hidden');
    qs('#step2').classList.remove('hidden');
  });

  // prática
  qs('#startPractice').addEventListener('click', () => {
    practiceActive = true;
    qs('#practiceBox').classList.remove('hidden');
    qs('#startPractice').classList.add('hidden');
    qs('#finishPractice').classList.remove('hidden');
    practiceIdx = 0;
    nextPracticeWord();
  });
  qs('#finishPractice').addEventListener('click', () => {
    practiceActive = false;
    qs('#step2').classList.add('hidden');
    qs('#step3').classList.remove('hidden');
    startCountdown(() => startRealTest());
  });

  document.addEventListener('keydown', onKey);

  // prepara a sequência: todas as permutações marca × palavra
  const pairs = [];
  for (const b of t.brands) {
    for (const w of t.words) {
      pairs.push({ brand: b, word: w });
    }
  }
  shuffle(pairs);
  state.seq = pairs;
  updateProgress();
}

function nextPracticeWord () {
  if (!practiceActive) return;
  const w = PRACTICE[practiceIdx % PRACTICE.length];
  qs('#practiceWord').textContent = w;
  practiceIdx++;
}

function startCountdown (done) {
  let n = 5;
  const el = qs('#countdown');
  el.textContent = n;
  const it = setInterval(() => {
    n--;
    el.textContent = n;
    if (n <= 0) {
      clearInterval(it);
      qs('#step3').classList.add('hidden');
      qs('#step4').classList.remove('hidden');
      showNextTrial();
      if (done) done();
    }
  }, 1000);
}

function showNextTrial () {
  if (state.idx >= state.seq.length) {
    endRun();
    return;
  }
  const pair = state.seq[state.idx];
  // mostra PRIME (imagem) por 300ms
  const img = qs('#primeImg');
  const wordBox = qs('#wordBox');
  wordBox.classList.add('hidden');
  img.classList.add('hidden');

  if (pair.brand.logoUrl) {
    img.src = pair.brand.logoUrl;
    img.classList.remove('hidden');
  }

  state.showingPrime = true;
  setTimeout(() => {
    // troca para palavra
    img.classList.add('hidden');
    wordBox.textContent = pair.word.text;
    wordBox.classList.remove('hidden');
    state.showingPrime = false;
    state.trialStartAt = performance.now();
  }, 300);
}

async function onKey (ev) {
  // atalhos só interessam na prática ou no teste real
  if (practiceActive) {
    if (ev.key.toLowerCase() === 'e' || ev.key.toLowerCase() === 'o') {
      nextPracticeWord();
    }
    return;
  }
  if (qs('#step4').classList.contains('hidden')) return;
  if (state.showingPrime) return;

  const k = ev.key.toLowerCase();
  if (k !== 'e' && k !== 'o') return;

  const isPositive = k === 'e';
  const rt = performance.now() - state.trialStartAt;

  const pair = state.seq[state.idx];
  // salva trial
  await postJSON(`/api/runs/${state.runId}/trials`, {
    brandId: pair.brand.id,
    wordId: pair.word.id,
    isPositive,
    rtMs: rt
  });

  state.idx++;
  updateProgress();

  // pequeno intervalo entre trials (150ms)
  qs('#wordBox').classList.add('hidden');
  setTimeout(() => showNextTrial(), 150);
}

function updateProgress () {
  qs('#progress').textContent = `${state.idx}/${state.seq.length}`;
}

async function endRun () {
  await postJSON(`/api/runs/${state.runId}/complete`, {});
  qs('#step4').classList.add('hidden');
  qs('#step5').classList.remove('hidden');

  const testId = state.test.id;
  qs('#goPan').href  = '/panorama?id=' + testId;
  qs('#goRuns').href = '/runs?id=' + testId;
  qs('#goTest').href = '/test?id=' + testId;
}

document.addEventListener('DOMContentLoaded', initRunPage);
