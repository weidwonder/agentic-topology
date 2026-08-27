document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-goto]');
  if (target) document.getElementById(`detail-${target.dataset.goto}`)?.scrollIntoView();
  if (event.target.closest('[data-back]')) window.scrollTo({ top: 0, behavior: 'smooth' });
});
