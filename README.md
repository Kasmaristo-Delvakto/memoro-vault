# How Memoro Vault Works

**Reclaiming Ownership in a World of Exposure**

In today’s digital world, personal data is not owned—it is extracted. Every search, backup, login, and cloud sync becomes part of a surveillance economy. Most people do not control their data. They rent access to it from companies who monetize it, mismanage it, or lose it entirely.

The rise of decentralized technologies has created new forms of digital value—cryptocurrency wallets, identity keys, encrypted archives—but the means of preserving them remain fragile. A lost password, corrupted drive, or compromised platform can erase everything.

**Memoro Vault changes that.**  
It enables anyone to encrypt critical files, instructions, and credentials into a portable, tamper-evident vault that can be stored anywhere and unlocked only through exact knowledge.

There are no servers, no logins, and no trusted intermediaries. Just a sealed vault file and a locally installed recovery program that runs entirely offline. Memoro Vault doesn’t manage access—it makes you prove it.

---

## The Problem Memoro Vault Solves

Access to long-term digital preservation is uneven. Some individuals rely on legal structures—trusts, foundations, estate attorneys—to transfer intent and assets across generations. Most do not. When someone passes away or loses capacity, accounts and data often remain locked behind proprietary systems or forgotten credentials.

The problem extends far beyond cryptocurrency:

- Family records lost in cloud accounts or inaccessible formats  
- Journalists and whistleblowers needing offline, tamper-proof storage  
- Parents wishing to pass on private messages, credentials, or creative work  
- Refugees or stateless persons needing durable access to identity documents  

**Memoro Vault allows users to define the conditions for recovery with cryptographic precision.**  
You can split knowledge across multiple trusted people—ensuring no one can access the vault alone, but collaboration enables recovery. It's inheritance without institutions, privacy without infrastructure, and permanence without fragility.

---

## Memory-Based Encryption

During creation, users define between **4 and 25 custom memory questions**. These can be personal, obscure, or collaboratively known.  
Answers are never stored. Instead, they are used to derive an AES-GCM encryption key using **PBKDF2**, a hardened key-stretching algorithm trusted in high-security systems.

---

## Layered Access Control

### Phase One: Initial Gatekeeping

- The first two answers act as a strict gate  
- Each incorrect attempt triggers an exponentially increasing lockout, slowing down brute-force attacks  
- No hints or feedback are given  

### Phase Two: Full Cryptographic Challenge

- The vault then requires all answers to be correct—entered exactly  
- Optional hints and character counts may be enabled by the creator to support intended users while still deterring attackers  

---

## File and Environment Security

- All files are encrypted individually with AES-256  
- Metadata, filenames, and messages are encrypted  
- Final output is a portable, tamper-evident ZIP archive  

Every vault is cryptographically bound to the exact version of the recovery program used to create it.  
If an attacker modifies the recovery file—even slightly—the vault becomes undecryptable.  
Decryption can only occur on the original, unmodified interface.

---

## Flexible Distribution

Memoro Vault supports a range of secure sharing strategies:

- Keep it private and self-recoverable  
- Distribute questions among multiple family members to require collaboration  
- Store vaults publicly—on cloud drives, SD cards, or IPFS—without compromising secrecy  

Without the correct answers and proof-of-work solution, the vault remains sealed—computationally and cryptographically.
