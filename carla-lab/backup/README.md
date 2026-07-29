# Backup dos dados da Carla

Hoje a pasta `data/` existe em um lugar só, no disco do VPS. Ela guarda os agendamentos,
os contatos das famílias, os alertas e o histórico das conversas. Não há cópia nenhuma.
Se esse disco morrer, a agenda do consultório vai junto e não tem de onde voltar.

`data/` está no `.gitignore` de propósito e continua fora do Git: são dados de pacientes,
inclusive de crianças, e eles não devem ir para um repositório. Backup e versionamento são
problemas diferentes, e este é o do backup.

## Instalação (uma vez, no servidor)

```bash
chmod +x /root/carla/carla-whatsapp-bot/carla-lab/backup/backup-dados.sh
mkdir -p /root/backups/carla

# roda uma vez na mão, pra ver funcionando
/root/carla/carla-whatsapp-bot/carla-lab/backup/backup-dados.sh

# depois, todo dia às 3h da manhã
crontab -e
0 3 * * *  /root/carla/carla-whatsapp-bot/carla-lab/backup/backup-dados.sh >> /root/carla/carla-whatsapp-bot/logs/backup.log 2>&1
```

Não precisa parar o bot. O script só lê a pasta `data/` e escreve o pacote em outro lugar.

## Como restaurar

```bash
# 1. ver o que existe
ls -lt /root/backups/carla/

# 2. conferir o conteúdo ANTES de mexer em qualquer coisa
tar -tzf /root/backups/carla/carla-dados-2026-07-28_0300.tar.gz

# 3. guardar o estado atual (nunca sobrescreva sem uma saída)
mv /root/carla/carla-whatsapp-bot/data /root/carla/carla-whatsapp-bot/data.antes-da-restauracao

# 4. restaurar
tar -xzf /root/backups/carla/carla-dados-2026-07-28_0300.tar.gz -C /root/carla/carla-whatsapp-bot/

# 5. reiniciar
pm2 restart ecosystem.config.js --update-env
```

O passo 3 não é excesso de cuidado: restaurar um backup velho por cima do estado atual
apaga os agendamentos feitos desde então. Com a pasta antiga guardada, dá para recuperar.

## O que o script garante

- **Escrita atômica.** Grava em `.parcial` e só renomeia no fim. Backup interrompido no
  meio nunca aparece com nome de backup bom.
- **Verificação.** Abre o pacote e confere que os arquivos de agendamentos e contatos
  estão lá dentro. Um backup que ninguém testou não é um backup.
- **Rotação com piso.** Apaga pacotes mais velhos que a janela (30 dias por padrão), mas
  nunca o mais recente. Melhor um backup velho do que nenhum.

## O que ele NÃO resolve

O pacote fica **no mesmo servidor** que os dados originais. Isso protege contra
apagar arquivo por engano, corrupção e erro de deploy. **Não protege** contra o servidor
inteiro sumir.

Para fechar esse buraco, é preciso uma cópia fora do VPS. É uma decisão sua, porque
envolve mandar dado de paciente para outro lugar e escolher onde. Duas opções, sem
recomendação até você decidir:

- `rclone`/`rsync` para um armazenamento seu (S3, Backblaze, outro servidor), com o pacote
  criptografado antes de sair;
- cópia manual periódica para uma máquina sua.

Em qualquer uma delas, o pacote sai criptografado, porque contém nome e telefone de
crianças. Enquanto isso não existir, o backup local já é muito melhor do que nada,
mas ele não é completo, e é honesto tratá-lo assim.

## Testes feitos

| Cenário | Resultado |
|---|---|
| Backup de uma pasta `data/` com agendamentos, contatos e alertas | pacote criado e verificado |
| Restauração em pasta limpa e comparação com o original | idêntico, arquivo por arquivo |
| Pasta de dados inexistente | erro claro, saída 1, nenhum pacote escrito |

Os três rodaram fora do servidor, com dados de mentira. O primeiro backup real precisa ser
feito e restaurado uma vez no VPS antes de considerar isto pronto.
