import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main>
      <p className="eyebrow">Projet NoSQL · ENSIIE</p>
      <h1>Le socle technique est en place.</h1>
      <p>
        Interface React et TypeScript, serveur Python, MongoDB et Redis.
      </p>
      <section aria-labelledby="next-step">
        <h2 id="next-step">Prochaines étapes</h2>
        <ol>
          <li>Initialiser les connecteurs du backend.</li>
          <li>Ajouter le formulaire et la persistance dans les deux bases.</li>
        </ol>
      </section>
      <p>Aucune saisie ni donnée utilisateur n’est encore enregistrée.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
