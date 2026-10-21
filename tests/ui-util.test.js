import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esc, html, raw } from '../app/js/ui/util.js';

test('esc 跳脫五種特殊字元', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('html 樣板：插入的文字一律跳脫，只有 html``／raw 的結果不跳脫', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.equal(html`<b>${evil}</b>`.s, '<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  assert.equal(html`<i>${html`<u>${evil}</u>`}</i>`.s, '<i><u>&lt;img src=x onerror=alert(1)&gt;</u></i>');
  assert.equal(html`<p>${raw('<br>')}</p>`.s, '<p><br></p>');
});

test('樣板：陣列攤平、false／null／undefined 不輸出、0 會輸出', () => {
  assert.equal(html`${[1, 'a', html`<x>`]}`.s, '1a<x>');
  assert.equal(html`${false}|${null}|${undefined}|${0}`.s, '|||0');
});

test('屬性裡的引號也不能被打破', () => {
  const name = '" onmouseover="alert(1)';
  const out = html`<button data-id="${name}">x</button>`.s;
  assert.equal(out, '<button data-id="&quot; onmouseover=&quot;alert(1)">x</button>');
});
