package com.team25.backend;

import java.util.TimeZone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BackendApplication {

	public static void main(String[] args) {
		useUtc();
		SpringApplication.run(BackendApplication.class, args);
	}

	/**
	 * Run the JVM in UTC regardless of the host. On Windows with IST the JVM default zone is the legacy
	 * alias "Asia/Calcutta", which the PostgreSQL 18 image rejects at connect time
	 * (FATAL: invalid value for parameter "TimeZone"). Tests get the same via -Duser.timezone=UTC in the pom.
	 */
	static void useUtc() {
		TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
	}

}
