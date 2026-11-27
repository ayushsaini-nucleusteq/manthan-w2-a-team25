package com.team25.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * Guidelines "secrets are kept only in the .env file", "never written into source code or committed" and ".env is
 * kept out of version control". Checks the files this repo ships (tests run from backend/).
 */
class SecretsConfigTest {

    private static final Path REPO = Path.of("..").toAbsolutePath().normalize();

    @Test
    void SEC_SECRETS_1_appConfigReadsEverySecretFromTheEnvironmentWithNoDefault() throws IOException {
        String props = Files.readString(Path.of("src/main/resources/application.properties"));
        assertThat(props).contains("spring.datasource.password=${DB_PASSWORD:}")
                .contains("app.jwt.secret=${JWT_SECRET:}")
                .contains("app.seed.user-password=${SEED_USER_PASSWORD:}");
    }

    @Test
    void SEC_SECRETS_1_composeTakesCredentialsFromEnvOnly() throws IOException {
        String compose = Files.readString(REPO.resolve("docker-compose.yml"));
        for (String key : List.of("POSTGRES_PASSWORD", "DB_PASSWORD", "GRAFANA_ADMIN_PASSWORD", "JWT_SECRET", "SEED_USER_PASSWORD")) {
            Matcher m = Pattern.compile("(?m)^\\s*" + key + ":\\s*(.+)$").matcher(compose);
            while (m.find()) {
                assertThat(m.group(1).strip()).as(key).startsWith("${");
            }
        }
    }

    @Test
    void SEC_SECRETS_3_envFileIsIgnoredAndOnlyThePlaceholderIsShipped() throws IOException {
        List<String> ignore = Files.readAllLines(REPO.resolve(".gitignore"));
        assertThat(ignore).contains(".env");
        String example = Files.readString(REPO.resolve(".env.example"));
        assertThat(example).contains("POSTGRES_PASSWORD=change-me").contains("SEED_USER_PASSWORD=change-me-demo-password")
                .contains("JWT_SECRET=\n");
    }

    @Test
    void SEC_SECRETS_2_noHardCodedSecretsInMainSources() throws IOException {
        Pattern suspicious = Pattern.compile(
                "(?i)(password|secret|apikey|api_key)\\s*=\\s*\"[^\"$<{][^\"]{5,}\"|-----BEGIN (RSA )?PRIVATE KEY|jdbc:postgresql://[^\\s\"]*password=");
        try (Stream<Path> files = Files.walk(Path.of("src/main"))) {
            for (Path f : files.filter(Files::isRegularFile).toList()) {
                String text = Files.readString(f);
                Matcher m = suspicious.matcher(text);
                if (m.find()) {
                    throw new AssertionError("possible hard-coded secret in " + f + ": " + m.group());
                }
            }
        }
    }
}
