  document.write('<input id="search-input" placeholder="搜索博文" />');
document.write('<div id="results-container"></div>');
document.write('<script src="//cdn.jsdelivr.net/npm/simple-jekyll-search/dest/simple-jekyll-search.min.js"></script>');
function loadStyle(url) {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  var head = document.getElementsByTagName('head')[0];
  head.appendChild(link);
}
loadStyle('//cdn.jsdelivr.net/gh/wu-kan/wu-kan.github.io@1788f1b6c2e12cca626b85f25749f99ca0c7aad0/public/simple-jekyll-search/search_box.min.css');
document.addEventListener("DOMContentLoaded", function () {
  SimpleJekyllSearch({
    json: '/public/simple-jekyll-search/search.json',
    searchInput: document.getElementById('search-input'),
    resultsContainer: document.getElementById('results-container')
  });
});
