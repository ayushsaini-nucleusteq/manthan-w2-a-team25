package com.team25.backend.policy;

import java.net.URI;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.domain.Money;
import com.team25.backend.policy.PolicyService.NewRule;
import com.team25.backend.policy.PolicyService.PolicyView;
import com.team25.backend.policy.PolicyService.Settings;
import com.team25.backend.policy.PolicyService.Summary;

/** F4 policy configuration: anyone can read; FINANCE_HEAD publishes new versions. */
@RestController
@Validated
@RequestMapping("/api/policy")
public class PolicyController {

    public record SettingsRequest(
            @NotNull @Pattern(regexp = Money.PATTERN) String receiptThreshold,
            @NotNull Boolean weekendFlagEnabled,
            @NotNull @Min(1) @Max(720) Integer overdueThresholdHours,
            @NotNull @Pattern(regexp = Money.PATTERN) String autoApproveMaxTotal,
            @NotNull @Pattern(regexp = Money.PATTERN) String auditorAboveTotal,
            @NotNull @Pattern(regexp = Money.PATTERN) String financeHeadAboveTotal,
            @NotNull @Min(0) @Max(100) Integer sampleAuditPercent) {
    }

    public record RuleRequest(
            @NotNull @Pattern(regexp = "^[A-Z0-9_]{2,50}$") String code,
            @NotBlank String category,
            @NotNull @Pattern(regexp = "PER_DAY|PER_NIGHT|PER_TRIP") String unit,
            @Pattern(regexp = "TIER1|OTHER") String cityTier,
            @NotNull @Pattern(regexp = Money.PATTERN) String softLimit,
            @NotNull @Pattern(regexp = Money.PATTERN) String hardLimit) {
    }

    public record CreateRequest(@NotNull @Min(1) Integer basedOnVersionNo, @NotBlank @Size(max = 500) String changeNote,
            @NotNull @Valid SettingsRequest settings, @NotNull @Size(max = 100) List<@Valid @NotNull RuleRequest> rules,
            @NotNull @Size(max = 200) List<@NotBlank @Size(max = 80) String> tier1Cities) {
    }

    private final PolicyService policy;

    public PolicyController(PolicyService policy) {
        this.policy = policy;
    }

    @GetMapping("/current")
    public PolicyView current() {
        return policy.current();
    }

    @GetMapping("/versions")
    public Page<Summary> versions(@RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return policy.versions(page, size);
    }

    @GetMapping("/versions/{versionNo}")
    public PolicyView version(@PathVariable @Min(1) int versionNo) {
        return policy.byNumber(versionNo);
    }

    @PostMapping("/versions")
    @PreAuthorize("hasRole('FINANCE_HEAD')")
    public ResponseEntity<PolicyView> publish(@AuthenticationPrincipal AppPrincipal me, @Valid @RequestBody CreateRequest r) {
        SettingsRequest s = r.settings();
        PolicyView v = policy.publish(me, r.basedOnVersionNo(), r.changeNote(),
                new Settings(s.receiptThreshold(), s.weekendFlagEnabled(), s.overdueThresholdHours(),
                        s.autoApproveMaxTotal(), s.auditorAboveTotal(), s.financeHeadAboveTotal(), s.sampleAuditPercent()),
                r.rules().stream().map(x -> new NewRule(x.code(), x.category(), x.unit(), x.cityTier(), x.softLimit(),
                        x.hardLimit())).toList(),
                r.tier1Cities());
        return ResponseEntity.created(URI.create("/api/policy/versions/" + v.versionNo())).body(v);
    }
}
