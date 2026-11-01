// Runs the geometry checks and lists the results on tests.html.
setTimeout(function () {
  var results;
  try { results = L3D.tests.run(); } catch (e) { results = [{ name: 'Test run crashed', ok: false, errors: [String(e)] }]; }
  var failed = results.filter(function (r) { return !r.ok; });
  var summary = document.getElementById('summary');
  summary.textContent = failed.length ? failed.length + ' of ' + results.length + ' checks failed' : 'All ' + results.length + ' checks passed';
  summary.className = 'summary ' + (failed.length ? 'bad' : 'ok');
  var list = document.getElementById('list');
  failed.concat(results.filter(function (r) { return r.ok; })).forEach(function (r) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="' + (r.ok ? 'ok">✓' : 'bad">✗') + '</span> ';
    li.appendChild(document.createTextNode(r.name));
    if (r.errors.length) {
      var e = document.createElement('div');
      e.className = 'err';
      e.textContent = r.errors.join('; ');
      li.appendChild(e);
    }
    list.appendChild(li);
  });
}, 0);
