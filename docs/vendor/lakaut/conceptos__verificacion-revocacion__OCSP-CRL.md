<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/conceptos/verificacion-revocacion/OCSP-CRL -->

# Verificación y revocación de certificados

Además de tener un período de vigencia definido, los certificados digitales pueden **perder su validez antes de su fecha de expiración**.  
Por este motivo, en los sistemas de firma digital existen mecanismos que permiten **verificar el estado actual de un certificado** al momento de firmar o validar una firma.

Este proceso se conoce como **verificación y revocación de certificados**.

------------------------------------------------------------------------

**¿Qué es la revocación de un certificado?**

La revocación es el proceso mediante el cual un certificado digital se invalida antes de su vencimiento.

Esto puede ocurrir, por ejemplo, cuando:

- La clave privada del titular se ve comprometida
- Se detecta un uso indebido del certificado
- Cambian los datos del titular
- El certificado deja de cumplir con las condiciones establecidas

Un certificado revocado **no debe ser utilizado para nuevas firmas**.

------------------------------------------------------------------------

**Por qué es importante verificar el estado del certificado**

Verificar el estado de un certificado permite asegurar que:

- El certificado estaba vigente al momento de la firma
- No fue revocado por la Autoridad Certificante
- La firma digital puede considerarse válida y confiable

Sin esta verificación, no es posible garantizar la confianza en una firma digital.

------------------------------------------------------------------------

**Mecanismos de verificación**

Existen dos mecanismos principales utilizados para verificar el estado de un certificado digital:

- **OCSP (Online Certificate Status Protocol)**
- **CRL (Certificate Revocation List)**

Ambos cumplen el mismo objetivo, pero funcionan de manera diferente.

------------------------------------------------------------------------

**OCSP**

OCSP es un mecanismo de verificación en línea que permite consultar **en tiempo real** el estado de un certificado digital.

Mediante OCSP, un sistema puede preguntar directamente si un certificado se encuentra:

- Válido
- Revocado
- Desconocido

Este método permite obtener respuestas rápidas y actualizadas sobre el estado del certificado.

------------------------------------------------------------------------

**CRL**

Las CRL son listas publicadas periódicamente por la Autoridad Certificante que contienen los certificados que han sido revocados.

Para verificar un certificado mediante CRL:

- Se consulta la lista publicada
- Se comprueba si el certificado figura como revocado

Este mecanismo no ofrece verificación en tiempo real, sino que depende de la frecuencia con la que se actualiza la lista.

------------------------------------------------------------------------

**Relación con la validez de la firma**

Los mecanismos de verificación y revocación permiten validar una firma digital considerando:

- El estado del certificado
- Su vigencia
- El momento en que se realizó la firma

Combinados con el sellado de tiempo, estos mecanismos aportan un alto nivel de confianza y respaldo legal al proceso de firma digital.

------------------------------------------------------------------------
