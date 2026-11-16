# Catalogue Formation SDIS 53 pour YunoHost

Ce dépôt prépare une instance YunoHost séparée du projet Firebase existant. **Il ne contient aucun script `firebase deploy` et l'application de production Firebase ne doit pas être modifiée pendant la migration.** FCM reste le seul service Firebase prévu pour les notifications Android.

## Accès prévus

- Catalogue et calendrier des formations : permission YunoHost publique (`visitors`).
- Administration et gestion des versions : permission nommée `catalogueformation.admin`, initialisée au groupe `admins`.
- Calendrier des agents : permission séparée `catalogueformation.agent_calendar`, initialisée au compte sélectionné lors de l'installation. D'autres utilisateurs pourront être ajoutés ou retirés dans YunoHost > Permissions.
- Les routes privées vérifient l'identité SSO YunoHost et un marqueur Nginx propre à la permission de chaque URL. L'API ne se fie pas à un rôle transmis dans le JSON du navigateur.

## Données Firestore

La sauvegarde source se trouve hors du dépôt :

`C:\Users\CESBRON\Documents\FirestoreBackups\seec-2da03\firestore-seec-2da03-2026-11-15T23-55-05-861Z.json`

Elle comprend 994 documents pour `seec-2da03` et possède une empreinte SHA-256 vérifiable. Ce fichier contient des URL privées de calendriers : **ne le placez jamais dans `src/` ni dans le répertoire web public**.

Après sauvegarde de la base locale Yunohost, lancer explicitement l'import sur le serveur cible :

```sh
node server/import-firestore.js /chemin/prive/vers/sauvegarde.json /home/yunohost.app/catalogueformation/firestore.json
```

L'import vérifie le projet, le format, les chemins, les doublons et l'empreinte ; il refuse de remplacer un magasin déjà rempli sans l'option `--replace`. Ne pas importer vers le projet Firebase distant. L'export ne contient pas les comptes Firebase Authentication ; les administrateurs sont des utilisateurs YunoHost.

La sauvegarde fournie ne contient pas les collections `announcements`, `catalogVersions`, `catalogReviewLinks` ou `catalogArchives`. Leur absence de cet export ne vaut pas autorisation de supprimer les annonces ou l'historique de relecture qui peuvent exister ailleurs.

## Notifications FCM

Le backend envoie les annonces et notifications ponctuelles directement à FCM, sur le sujet Android existant `announcements`, avec un compte de service du projet `seec-2da03`. Fournir une clé de compte de service à laquelle le rôle FCM minimal nécessaire a été accordé. Le fichier doit rester privé, hors de `src/`, avec des permissions système restrictives. Le serveur n'envoie aucune clé au navigateur. La PWA n'est pas automatiquement abonnée à FCM. L'envoi vers le projet distant n'a pas été essayé pendant ce travail.

## Vérifications locales

```sh
npm test
npm run check
```

Ces tests Node.js ne lancent pas d'émulateur Firebase et n'effectuent aucun déploiement réseau. Une installation réelle exige un serveur YunoHost 12.1.40+ avec accès à FCM si les notifications sont activées.

## État de la migration

Le squelette du paquet, le backend initial, l'importeur Firestore, la configuration des permissions, l'envoi FCM et leurs tests sont présents. **La migration fonctionnelle de toutes les pages (remplacement des modules Firebase, des flux ICS Cloudflare et du workflow de relecture, y compris les versions/historiques et données manquantes) reste en cours. Ce paquet n'est pas encore prêt à installer comme remplacement complet.** Ne basculez pas les utilisateurs et ne supprimez aucun service Firebase avant validation de bout en bout et comparaison des données.
