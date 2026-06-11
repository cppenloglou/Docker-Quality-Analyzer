# Στατιστικά Φάσης Β (τελικά)

- Σύνολο artifacts: 102 | Ολοκληρωμένες αναλύσεις: 102/102 (100.0%)
- Dockerfiles: 49 | Compose: 53

## Κατανομή βαθμίδων

| Τύπος | A | B | C | D | F | Μέσο score |
|---|---|---|---|---|---|---|
| Dockerfile | 4 | 25 | 12 | 6 | 2 | 71.9 |
| Compose | 1 | 2 | 7 | 1 | 42 | 23.1 |
| Σύνολο | 5 | 27 | 19 | 7 | 44 | 46.6 |

## Συχνότεροι κωδικοί ευρημάτων (Top 12)

| Κωδικός | Εμφανίσεις | Αρχεία με ≥1 |
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

- Dockerfiles με :latest base image (DL3007): 4/49 (8.2%)
- Dockerfiles χωρίς οδηγία USER (SEC002): 39/49 (79.6%)
- Dockerfiles με unpinned εξαρτήσεις (DL3008/DL3013/DL3016/DL3018): 23/49 (46.9%)
- Αρχεία με security finding secret/password: 33/102 (32.4%)
- Compose με image χωρίς ρητό tag: 25/53 (47.2%)
- Αρχεία με DL1000 (αποτυχία parsing Hadolint): 16/49 (32.7%)

## Runnability (Compose)

- Με δεδομένα runnability: 53/53
- **Runnable: 2/53 (3.8%) | Blocked: 51/53 (96.2%)**

### Αποτυχίες ανά κανόνα precheck

| Κανόνας | Αρχεία που αποτυγχάνουν | % |
|---|---|---|
| Απουσία services | 0 | 0.0% |
| Build context (απαιτεί αρχεία project) | 32 | 60.4% |
| Bind mounts προς τον host | 33 | 62.3% |
| Εξάρτηση από env_file | 7 | 13.2% |
| Μη επιλυμένες μεταβλητές ${VAR} | 11 | 20.8% |
| External volumes/networks | 1 | 1.9% |
| Image χωρίς ρητό non-latest tag | 45 | 84.9% |
| Επικίνδυνες runtime επιλογές (privileged/host net/cap_add/devices) | 5 | 9.4% |

### Κατανομή λόγων αποκλεισμού (από reasons)

| Λόγος | Αρχεία |
|---|---|
| Bind mount | 33 |
| Build context | 32 |
| Απουσία image reference | 29 |
| Μη σταθερό image tag | 25 |
| Μη επιλυμένες ${VAR} | 11 |
| Εξάρτηση από env_file | 7 |
| Host network mode | 3 |
| cap_add | 3 |
| External volume/network | 1 |
| Privileged mode | 1 |

### Αριθμός αποτυχημένων κανόνων ανά blocked αρχείο

| Αποτυχημένοι κανόνες | Αρχεία |
|---|---|
| 1 | 6 |
| 2 | 17 |
| 3 | 20 |
| 4 | 6 |
| 5 | 2 |

### Runnable αρχεία (ονομαστικά)

- awesome-compose__nextcloud-postgres.yml (score 17, grade F)
- awesome-compose__nextcloud-redis-mariadb.yml (score 0, grade F)