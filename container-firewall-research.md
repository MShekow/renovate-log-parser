To restrict outbound HTTPS connections to specific domains from a Docker container on Linux, we must address a fundamental networking challenge: standard Linux firewalls (like `iptables` or `nftables`) operate at Layer 3/4 (IP and ports), whereas domain names are Layer 7 concepts.

Because domains can resolve to multiple, frequently changing IP addresses (especially when using CDNs), blocking by static IP addresses is often unreliable.

Two of the most common and robust methods to achieve this are:

1. **The Proxy Approach (Recommended for reliability)**: Routing the container's traffic through an egress proxy (like Squid) that inspects and filters connection requests based on the destination host.
2. **The DNS Sinkhole Approach**: Configuring the container to use a controlled DNS server that blocks resolutions for specific domains, combined with firewall rules to prevent DNS bypass.

---

### Method 1: Egress Proxy (Squid)
This method is reliable because HTTP clients using HTTPS will send a `CONNECT` request to the proxy containing the destination domain name in plain text (e.g., `CONNECT github.com:443`). The proxy can block this request before the encrypted TLS session is established, without needing to decrypt the traffic or install custom certificates on the client.

#### Step 1: Set up the Squid Proxy
You can run Squid in a container. Create a configuration file named `squid.conf`:

```text
# Define the port Squid listens on
http_port 3128

# Define the domains you want to block (use a leading dot to match subdomains)
acl blocked_domains dstdomain .instagram.com .facebook.com

# Deny access to the blocked domains
http_access deny blocked_domains

# Allow other traffic
http_access allow all
```

Run the Squid container on a shared Docker network:
```bash
docker network create proxy-net

docker run -d \
  --name egress-proxy \
  --network proxy-net \
  -v $(pwd)/squid.conf:/etc/squid/squid.conf \
  ubuntu/squid:latest
```

#### Step 2: Configure your Application Container
Run your application container on the same network and configure it to use the proxy via standard environment variables:

```bash
docker run -it --rm \
  --network proxy-net \
  -e http_proxy="http://egress-proxy:3128" \
  -e https_proxy="http://egress-proxy:3128" \
  curlimages/curl sh
```

**Testing inside the container:**
* Allowed domain: `curl -I https://www.google.com` (Should succeed)
* Blocked domain: `curl -I https://www.instagram.com` (Should return a `403 Forbidden` error from the proxy)

**Limitations:** The target container's application must respect the `http_proxy` and `https_proxy` environment variables.

---

### Method 2: DNS Sinkholing + Firewall Locking
If the application inside your container does not support proxy environment variables, you can intercept its DNS queries.

#### Step 1: Run a Local DNS Server (e.g., dnsmasq)
Create a `dnsmasq.conf` file to resolve blocked domains to an unreachable IP (like `0.0.0.0`):

```text
# Send queries to public DNS by default
server=1.1.1.1
server=8.8.8.8

# Block specific domains
address=/instagram.com/0.0.0.0
address=/facebook.com/0.0.0.0
```

Run the DNS container on a bridge network (e.g., the default bridge or a custom one):
```bash
docker run -d \
  --name dns-filter \
  -v $(pwd)/dnsmasq.conf:/etc/dnsmasq.conf \
  --cap-add=NET_ADMIN \
  andysh/dnsmasq:latest
```
*Note the internal IP address of this container (e.g., `172.17.0.2`).*

#### Step 2: Run the Target Container using the Filtered DNS
Launch your application container, forcing it to use the `dns-filter` container for DNS resolution:

```bash
docker run -it --rm \
  --dns 172.17.0.2 \
  curlimages/curl sh
```

#### Step 3: Prevent DNS Bypass via iptables (Optional but Recommended)
A sophisticated container or user might attempt to bypass the DNS server by querying public DNS (like `8.8.8.8`) directly over port 53. To prevent this, you can apply an `iptables` rule on the host to block all outbound DNS traffic from the container except to your DNS filter.

Find the IP of your target container (e.g., `172.17.0.3`) and run on the host:

```bash
# Allow the container to talk to the local DNS server on port 53
iptables -I FORWARD -s 172.17.0.3 -d 172.17.0.2 -p udp --dport 53 -j ACCEPT
iptables -I FORWARD -s 172.17.0.3 -d 172.17.0.2 -p tcp --dport 53 -j ACCEPT

# Block all other outbound DNS traffic from this container
iptables -A FORWARD -s 172.17.0.3 -p udp --dport 53 -j DROP
iptables -A FORWARD -s 172.17.0.3 -p tcp --dport 53 -j DROP
```

**Limitations:** If the application bypasses DNS entirely by hardcoding the destination IP addresses, this method will not stop the connection.

---

### Summary of trade-offs

* **Egress Proxy (Squid):** More robust against IP changes and direct IP connections, but relies on the container's application honoring proxy settings.
* **DNS Sinkhole:** Works transparently for any application without configuration changes, but can be bypassed if the application uses hardcoded IP addresses instead of domain names.

----

User:
By "blocked", I mean that I want to simulate a firewall that instead returns dummy HTML pages with a self-signed TLS certificate:

Agent:
To simulate a firewall that intercepts HTTPS traffic and returns a dummy HTML page with a self-signed certificate, you are essentially performing a **controlled Man-in-the-Middle (MitM)** setup.

Because TLS/HTTPS is designed to prevent exactly this scenario, modern HTTP clients inside your container will reject the connection as untrusted by default. To make this work seamlessly, you must both redirect the traffic and configure the client container to trust your custom certificate authority (CA).

Here is a step-by-step implementation using **Nginx** as the dummy server and **DNS redirection**.

### Step 1: Create a Custom Certificate Authority (CA) and Server Certificate
To prevent having to manage individual self-signed certificates for every blocked domain, we will create a local Certificate Authority (CA). We will use this CA to sign a wildcard certificate for the blocked domains.

On your host machine, run the following commands to generate the certificates:

```bash
# 1. Create a private key for your custom CA
openssl genrsa -out MyLocalCA.key 2048

# 2. Create the CA certificate
openssl req -x509 -new -nodes -key MyLocalCA.key -sha256 -days 3650 \
  -subj "/CN=My Local Firewall CA" -out MyLocalCA.pem

# 3. Create a private key for the dummy web server
openssl genrsa -out dummy-server.key 2048

# 4. Create a certificate signing request (CSR) config to support wildcard domains
cat <<EOF > csr.conf
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn

[dn]
CN = Blocked Domain Portal

[v3_ext]
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = *.instagram.com
DNS.2 = instagram.com
DNS.3 = *.facebook.com
DNS.4 = facebook.com
EOF

# 5. Create the CSR
openssl req -new -key dummy-server.key -out dummy-server.csr -config csr.conf

# 6. Sign the certificate using your custom CA
openssl x509 -req -in dummy-server.csr -CA MyLocalCA.pem -CAkey MyLocalCA.key \
  -CAcreateserial -out dummy-server.crt -days 365 -sha256 \
  -extfile csr.conf -extensions v3_ext
```

---

### Step 2: Set up the Nginx Dummy Server
Create an Nginx configuration file named `nginx.conf`:

```nginx
events {}

http {
    server {
        listen 80;
        listen 443 ssl;
        server_name _;

        # SSL Certificates
        ssl_certificate /etc/nginx/certs/dummy-server.crt;
        ssl_certificate_key /etc/nginx/certs/dummy-server.key;

        # Return the dummy HTML page
        location / {
            default_type text/html;
            return 200 '<html><head><title>Access Blocked</title></head><body style="font-family:sans-serif; text-align:center; padding-top:100px;"><h1>🚫 Access Blocked</h1><p>This domain has been restricted by your administrator.</p></body></html>';
        }
    }
}
```

Now, run the Nginx container on a custom Docker network:

```bash
docker network create block-net

docker run -d \
  --name dummy-webserver \
  --network block-net \
  -v $(pwd)/nginx.conf:/etc/nginx/nginx.conf:ro \
  -v $(pwd)/dummy-server.crt:/etc/nginx/certs/dummy-server.crt:ro \
  -v $(pwd)/dummy-server.key:/etc/nginx/certs/dummy-server.key:ro \
  nginx:alpine
```

---

### Step 3: Redirect Blocked Traffic to the Dummy Server
You can use dnsmasq to resolve the blocked domains to the Nginx container's IP address.

First, get the IP address of the `dummy-webserver` container on the `block-net` network:
```bash
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' dummy-webserver
```
*(Assuming the IP returned is `172.18.0.2`)*

Create a `dnsmasq.conf` file:
```text
server=1.1.1.1
# Point the blocked domains to the dummy Nginx container
address=/instagram.com/172.18.0.2
address=/facebook.com/172.18.0.2
```

Run the DNS server container on the same network:
```bash
docker run -d \
  --name dns-interceptor \
  --network block-net \
  --cap-add=NET_ADMIN \
  -v $(pwd)/dnsmasq.conf:/etc/dnsmasq.conf \
  andysh/dnsmasq:latest
```
*(Assuming the DNS container IP is `172.18.0.3`)*

---

### Step 4: Run the Client Container and Trust the CA

To make the client container trust your self-signed certificates without failing the TLS handshake, you must import the `MyLocalCA.pem` certificate into the container’s trust store.

Here is how you can achieve this with an Alpine-based client container:

```bash
# Start the container pointing to our intercepting DNS
docker run -it --rm \
  --network block-net \
  --dns 172.18.0.3 \
  -v $(pwd)/MyLocalCA.pem:/usr/local/share/ca-certificates/MyLocalCA.crt:ro \
  alpine sh
```

**Inside the container shell, run the following to update the CA store and test:**

```sh
# 1. Install curl and CA certificates management tools
apk add --no-cache curl ca-certificates

# 2. Update the system's trusted CA store with our mounted cert
update-ca-certificates

# 3. Test a clean, allowed connection
curl -I https://www.google.com

# 4. Test the blocked connection
curl https://www.instagram.com
```

### Result
The request to `https://www.instagram.com` will be intercepted, the TLS handshake will complete successfully because the container trusts your local CA, and `curl` will output the dummy HTML page:

```html
<html><head><title>Access Blocked</title></head>...<h1>🚫 Access Blocked</h1>...
```
