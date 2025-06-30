# Memoro Vault 10 XMR Bounty Postmortem & Security Roadmap

## Background

In June 2025, a critical vulnerability in version 1.0.4 of Memoro Vault's `build.html` logic allowed the full compromise of a high-security vault protected by a 10 XMR bounty. The issue stemmed from architectural decisions that, while originally intended to simplify Layer 2 (L2) recovery logic, ultimately allowed adversaries to extract and crack all answer hashes individually.

The vulnerability was discovered after the bounty vault was successfully cracked and claimed by user "desktop_monitor". The flaw has since been fully analyzed, and major fixes are now underway.

---

## The Exploit

### What Went Wrong

- **Individual Answer Hash Exposure**  
  After passing a lightweight Layer 1 challenge, an attacker could extract the full list of per-answer SHA-256 hashes from the `vault.meta` file. These were visible by inspecting the decrypted `questionList` object in browser memory after L1 decryption.

- **Entropy Fragmentation**  
  Instead of hashing all answers together, each answer was independently hashed and stored. This allowed attackers to crack each answer with Hashcat or similar tools one-by-one, rather than facing the full compounded entropy.

---

### Analogy: The Zebra Herd

In nature, zebras avoid predators by staying in a herd. Their stripes blend together, confuse predators, and reduce the chance of any single zebra being singled out. But when separated, they become easy targets.

The original Memoro Vault design scattered its answers like lone zebras. Each one could be picked off with ease. The updated model binds them into one indistinguishable unit — secure only when kept together.

---

### The Entropy Collapse: By the Numbers

- **Expected Brute-Force Space (All Answers Combined):**  
  `26^110` =  
  541,296,911,284,317,726,173,022,153,281,237,510,155,274,656,147,830,387,458,285,099,821,664,356,750,564,242,609,215,425,339,379,787,596,067,126,825,757,723,852,664,992,841,749,640,878,472,976,829,564,627,601,100,166,722,608,953,094,417,224,176,608,147,035,708,193,510,658,617,6

- **Actual Brute-Force Space (Cracked Hashes Individually):**  
  ≈ 13,412,302,525,600,512,061,140,992,000,000  
  (~1.34 × 10^34)

- **Reduction in Entropy:**  
  > Over 120 orders of magnitude

- **Result:**  
  What should have taken trillions of years could be cracked in under 30 minutes on consumer-grade GPUs

---

## Why This Was Possible

- `vault.meta` was encrypted **only behind Layer 1**
- Layer 1 was made intentionally weak (two short answers) to facilitate bounty testing
- Once decrypted, `questionList` exposed individual answer hashes in plain JSON
- Hashcat was used to crack them in parallel

---

## Fixes In Progress for version 1.0.5

### 1. Combined Answer Hash Behind All Constraints
- `SHA256(answer1 + answer2 + ... + answer25)` is now encrypted inside `vault.meta`
- Cannot be accessed unless:
  - Layer 1 is solved
  - **All answers are correct**
  - Static PoW is solved
  - Original `recover.html` matches integrity hash

### 2. `recover.html` Binding
- Its hash is now included in the final key derivation
- Tampering or modification renders vault unrecoverable

### 3. Delayed Hints
- Letter and character count hints are withheld until **50% of an answer** is correct

### 4. No Incremental Validation
- No per-answer checking
- Only full set of answers is validated at once
- Either all correct — or total lockout

---

## Key Derivation Logic (Updated)

```js
SHA256(
  powSalt +
  powChallenge +
  fullConcat +
  powNonce +
  recoverHtmlHash
)
```

---

## New Bounty Vault: July 2025

I will launch a new Memoro Vault bounty at the end of July 2025:
- Starting prize: **1 XMR**
- Every month, 1 more XMR will be added (for 12 months)
- If uncracked, the bounty will be retrieved in July 2026
- Community contributions to the bounty pool are welcome

This vault will use the hardened logic described above.
