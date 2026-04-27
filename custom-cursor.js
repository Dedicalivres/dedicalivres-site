// TRAÎNÉE PREMIUM DÉDICALIVRES

(function () {

  if (window.innerWidth <= 768) return;

  let lastTrail = 0;

  document.addEventListener("mousemove", (event) => {
    const x = event.clientX;
    const y = event.clientY;

    const now = Date.now();

    if (now - lastTrail > 45) {
      createTrail(x, y);
      lastTrail = now;
    }
  });

  function createTrail(x, y) {
    const book = document.createElement("span");
    book.className = "book-trail";

    const offsetX = (Math.random() - 0.5) * 18;
    const offsetY = (Math.random() - 0.5) * 18;

    const rotation = (Math.random() - 0.5) * 40;
    const driftX = (Math.random() - 0.5) * 40;
    const driftY = 10 + Math.random() * 35;
    const scale = 0.8 + Math.random() * 0.4;

    book.style.left = `${x + offsetX}px`;
    book.style.top = `${y + offsetY}px`;

    book.style.setProperty("--rotation", `${rotation}deg`);
    book.style.setProperty("--drift-x", `${driftX}px`);
    book.style.setProperty("--drift-y", `${driftY}px`);
    book.style.setProperty("--scale", scale);

    document.body.appendChild(book);

    setTimeout(() => {
      book.remove();
    }, 900);
  }

})();
