//! TLS layer: channel encryption + **server** authentication.
//!
//! The client authenticates the server by **pinning the server's exact
//! certificate** (`ServerTrust::Pinned`) — robust across self-signed dev certs
//! and fly hostnames/IPs alike, with no public-CA dependency. (The complementary
//! direction — authenticating the *client* — is the did:key challenge in
//! [`crate::challenge`], not TLS client-auth.)

use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use tokio_rustls::{TlsAcceptor, TlsConnector};

/// TLS exporter label for the channel binding folded into the signed challenge.
pub const CB_LABEL: &[u8] = b"avenos/sync-mini v1";

/// Export the 32-byte TLS channel binding for this session, base64. Identical on
/// both ends of the same TLS session (the exporter property) → folded into the
/// signed challenge message to defeat credential relay.
pub fn channel_binding_b64(out: [u8; 32]) -> String {
    B64.encode(out)
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// The server's cert + private key (DER), and the acceptor it builds.
#[derive(Clone)]
pub struct ServerTls {
    pub cert_der: Vec<u8>,
    pub key_der: Vec<u8>,
}

impl ServerTls {
    /// Build from raw DER cert + PKCS#8 key.
    pub fn from_der(cert_der: Vec<u8>, key_der: Vec<u8>) -> Self {
        Self { cert_der, key_der }
    }

    /// Parse a PEM cert chain + PKCS#8 key (the fly-secrets path).
    pub fn from_pem(cert_pem: &[u8], key_pem: &[u8]) -> crate::Result<Self> {
        let cert = rustls_pemfile::certs(&mut &cert_pem[..])
            .next()
            .ok_or_else(|| crate::P2pError::Config("no certificate in PEM".into()))?
            .map_err(|e| crate::P2pError::Config(format!("cert pem: {e}")))?;
        let key = rustls_pemfile::pkcs8_private_keys(&mut &key_pem[..])
            .next()
            .ok_or_else(|| crate::P2pError::Config("no pkcs8 key in PEM".into()))?
            .map_err(|e| crate::P2pError::Config(format!("key pem: {e}")))?;
        Ok(Self {
            cert_der: cert.as_ref().to_vec(),
            key_der: key.secret_pkcs8_der().to_vec(),
        })
    }

    /// The trust handle a client uses to pin this exact server.
    pub fn trust(&self) -> ServerTrust {
        ServerTrust::Pinned(self.cert_der.clone())
    }

    pub fn acceptor(&self) -> crate::Result<TlsAcceptor> {
        let cert = CertificateDer::from(self.cert_der.clone());
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.key_der.clone()));
        let cfg = rustls::ServerConfig::builder_with_provider(provider())
            .with_safe_default_protocol_versions()
            .map_err(|e| crate::P2pError::Tls(format!("server versions: {e}")))?
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .map_err(|e| crate::P2pError::Tls(format!("server cert: {e}")))?;
        Ok(TlsAcceptor::from(Arc::new(cfg)))
    }
}

/// How a client decides to trust the server it dials.
#[derive(Clone, Debug)]
pub enum ServerTrust {
    /// Pin the server's exact certificate DER (SPKI/cert pinning).
    Pinned(Vec<u8>),
}

impl ServerTrust {
    pub fn connector(&self) -> crate::Result<TlsConnector> {
        let ServerTrust::Pinned(pinned) = self;
        let verifier = Arc::new(PinnedServerCert {
            pinned: pinned.clone(),
            provider: provider(),
        });
        let cfg = rustls::ClientConfig::builder_with_provider(provider())
            .with_safe_default_protocol_versions()
            .map_err(|e| crate::P2pError::Tls(format!("client versions: {e}")))?
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();
        Ok(TlsConnector::from(Arc::new(cfg)))
    }
}

/// Generate a self-signed cert (dev / fly-without-CA). Returns `ServerTls`.
pub fn generate_self_signed(subject_alt_names: Vec<String>) -> crate::Result<ServerTls> {
    let sans = if subject_alt_names.is_empty() {
        vec!["localhost".to_string()]
    } else {
        subject_alt_names
    };
    let ck = rcgen::generate_simple_self_signed(sans)
        .map_err(|e| crate::P2pError::Config(format!("rcgen: {e}")))?;
    Ok(ServerTls {
        cert_der: ck.cert.der().to_vec(),
        key_der: ck.key_pair.serialize_der(),
    })
}

/// A `ServerCertVerifier` that accepts exactly one pinned end-entity cert and
/// ignores hostname (we authenticate by pinning, not by name).
#[derive(Debug)]
struct PinnedServerCert {
    pinned: Vec<u8>,
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl rustls::client::danger::ServerCertVerifier for PinnedServerCert {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if end_entity.as_ref() == self.pinned.as_slice() {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("pinned server cert mismatch".into()))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}
