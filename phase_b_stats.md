# Στατιστικά Φάσης Β

- Σύνολο artifacts: 102 | Ολοκληρωμένες αναλύσεις: 102/102 (100.0%) (δείκτης αξιοπιστίας)
- Dockerfiles: 49 | Compose: 53

## Κατανομή βαθμίδων (Πίνακας: Grade distribution)

| Τύπος | A | B | C | D | F | Μέσο score |
|---|---|---|---|---|---|---|
| Dockerfile | 4 | 25 | 12 | 6 | 2 | 71.9 |
| Compose | 1 | 2 | 7 | 1 | 42 | 23.1 |
| Σύνολο | 5 | 27 | 19 | 7 | 44 | 46.6 |

## Συχνότεροι κωδικοί ευρημάτων (Top 12)

| Κωδικός | Εμφανίσεις | % αρχείων με ≥1 εμφάνιση |
|---|---|---|
| service-keys-order | 557 | 49/102 (48.0%) |
| SEC001 | 337 | 59/102 (57.8%) |
| services-alphabetical-order | 171 | 28/102 (27.5%) |
| require-quotes-in-ports | 150 | 42/102 (41.2%) |
| no-unbound-port-interfaces | 147 | 49/102 (48.0%) |
| service-image-require-explicit-tag | 66 | 25/102 (24.5%) |
| require-project-name-field | 50 | 50/102 (49.0%) |
| SEC002 | 39 | 39/102 (38.2%) |
| DL3018 | 24 | 17/102 (16.7%) |
| service-dependencies-alphabetical-order | 23 | 7/102 (6.9%) |
| no-quotes-in-volumes | 23 | 5/102 (4.9%) |
| DL1000 | 16 | 16/102 (15.7%) |

## Επιπολασμός βασικών προβλημάτων

- Dockerfiles με μη σταθερό base image (DL3007): 4/49 (8.2%)
- Dockerfiles χωρίς οδηγία USER (custom rule, αν προστέθηκε): 38/49 (77.6%)  ← προσαρμόσε στον κωδικό του κανόνα σου
- Dockerfiles με unpinned εξαρτήσεις (DL3008/DL3013/DL3016): 8/49 (16.3%)
- Αρχεία με security finding 'secret/password': 33/102 (32.4%)
- Compose με image χωρίς ρητό tag (service-image-require-explicit-tag): 25/53 (47.2%)

## Runnability (Compose)

- Runnable: 53/53 (100.0%) | Blocked: 0/53 (0.0%)
- (Έλεγξε/προσάρμοσε την ανίχνευση runnable/blocked στο πεδίο meta των δικών σου αποτελεσμάτων — δες ένα JSON δείγμα και διόρθωσε το κλειδί.)

| Λόγος αποκλεισμού (μοτίβο) | Εμφανίσεις |
|---|---|
| env_file | 53 |
| external | 53 |
| unresolved | 53 |
| bind mount | 33 |
| build context | 32 |
| non-latest | 25 |
| host network | 3 |
| cap_add | 3 |
| privileged | 1 |